/**
 * Minimal XML reader for eBay's Trading API responses (plain element trees).
 *
 * Deliberately small instead of a general parser dependency: elements, attributes, text,
 * CDATA, comments and the five predefined entities plus numeric character references.
 * A DOCTYPE is rejected, so there are no custom entities and no entity-expansion attacks.
 * Namespace prefixes are kept as part of the name; eBay uses a default namespace only.
 */

export interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  /** Concatenated text directly inside this element (entities decoded), untrimmed. */
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

export const MAX_XML_LENGTH = 20 * 1024 * 1024;
const MAX_DEPTH = 100;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

export function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const ATTRIBUTE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseTag(source: string): { name: string; attributes: Record<string, string> } {
  const name = /^[^\s/]+/.exec(source)?.[0];
  if (!name) throw new XmlParseError("Malformed tag");
  const attributes: Record<string, string> = {};
  for (const match of source.slice(name.length).matchAll(ATTRIBUTE)) {
    attributes[match[1]!] = decodeXmlEntities(match[2] ?? match[3] ?? "");
  }
  return { name, attributes };
}

/** Parses a document and returns its root element. */
export function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_XML_LENGTH) throw new XmlParseError("XML document too large");

  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let position = 0;

  const expectEnd = (terminator: string, from: number, what: string) => {
    const end = xml.indexOf(terminator, from);
    if (end === -1) throw new XmlParseError(`Unterminated ${what}`);
    return end;
  };

  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    const text = xml.slice(position, open === -1 ? xml.length : open);
    const current = stack.at(-1);
    if (current) current.text += decodeXmlEntities(text);
    else if (text.trim() !== "") throw new XmlParseError("Text outside the root element");
    if (open === -1) break;

    if (xml.startsWith("<!--", open)) {
      position = expectEnd("-->", open + 4, "comment") + 3;
    } else if (xml.startsWith("<![CDATA[", open)) {
      const end = expectEnd("]]>", open + 9, "CDATA section");
      if (!current) throw new XmlParseError("CDATA outside the root element");
      current.text += xml.slice(open + 9, end);
      position = end + 3;
    } else if (xml.startsWith("<?", open)) {
      position = expectEnd("?>", open + 2, "processing instruction") + 2;
    } else if (xml.startsWith("<!", open)) {
      throw new XmlParseError("DOCTYPE and other declarations are not supported");
    } else {
      const close = expectEnd(">", open + 1, "tag");
      const inner = xml.slice(open + 1, close);
      position = close + 1;

      if (inner.startsWith("/")) {
        const node = stack.pop();
        if (!node || node.name !== inner.slice(1).trim()) throw new XmlParseError("Mismatched closing tag");
      } else {
        if (root && stack.length === 0) throw new XmlParseError("More than one root element");
        const selfClosing = inner.endsWith("/");
        const node: XmlNode = { ...parseTag(selfClosing ? inner.slice(0, -1) : inner), children: [], text: "" };
        if (current) current.children.push(node);
        else root = node;
        if (!selfClosing) {
          if (stack.length >= MAX_DEPTH) throw new XmlParseError("XML nested too deeply");
          stack.push(node);
        }
      }
    }
  }

  if (stack.length > 0) throw new XmlParseError("Unclosed element");
  if (!root) throw new XmlParseError("No root element");
  return root;
}

/** First descendant reached by following child element names, or undefined. */
export function xmlChild(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current = node;
  for (const name of path) {
    current = current?.children.find((child) => child.name === name);
    if (!current) return undefined;
  }
  return current;
}

export function xmlChildren(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((child) => child.name === name) ?? [];
}

/** Trimmed text of the element at `path`, or undefined when missing or empty. */
export function xmlText(node: XmlNode | undefined, ...path: string[]): string | undefined {
  const text = xmlChild(node, ...path)?.text.trim();
  return text ? text : undefined;
}
