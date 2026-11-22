import { describe, expect, it } from "vitest";
import { decodeXmlEntities, parseXml, xmlChild, xmlChildren, xmlText, XmlParseError } from "../../src/common/xml.js";

describe("parseXml", () => {
  it("reads elements, attributes and text", () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="UTF-8"?>
       <Response xmlns="urn:ebay:apis:eBLBaseComponents">
         <Ack>Success</Ack>
         <Item><ItemID>123</ItemID><Price currencyID="EUR" note='a "b"'>12.50</Price></Item>
         <Item><ItemID>456</ItemID></Item>
         <Empty/>
       </Response>`,
    );

    expect(root.name).toBe("Response");
    expect(root.attributes.xmlns).toBe("urn:ebay:apis:eBLBaseComponents");
    expect(xmlText(root, "Ack")).toBe("Success");
    expect(xmlChildren(root, "Item").map((item) => xmlText(item, "ItemID"))).toEqual(["123", "456"]);
    expect(xmlChild(root, "Item", "Price")?.attributes).toEqual({ currencyID: "EUR", note: 'a "b"' });
    expect(xmlText(root, "Item", "Price")).toBe("12.50");
    expect(xmlChild(root, "Empty")).toMatchObject({ name: "Empty", children: [], text: "" });
  });

  it("returns undefined for missing paths and empty text", () => {
    const root = parseXml("<a><b>  </b></a>");
    expect(xmlText(root, "b")).toBeUndefined();
    expect(xmlText(root, "missing", "deeper")).toBeUndefined();
    expect(xmlChildren(undefined, "x")).toEqual([]);
  });

  it("decodes entities, numeric references and CDATA, and skips comments", () => {
    const root = parseXml(
      "<t><a>Tom &amp; Jerry &lt;3 &quot;x&quot; &apos;y&apos;</a><b>&#228;&#x20AC;</b>" +
        "<c><![CDATA[<raw> & stuff]]></c><!-- <ignored>&amp;</ignored> --><d q=\"a&amp;b\"/></t>",
    );
    expect(xmlText(root, "a")).toBe("Tom & Jerry <3 \"x\" 'y'");
    expect(xmlText(root, "b")).toBe("ä€");
    expect(xmlText(root, "c")).toBe("<raw> & stuff");
    expect(xmlChild(root, "ignored")).toBeUndefined();
    expect(xmlChild(root, "d")?.attributes.q).toBe("a&b");
  });

  it("leaves unknown entities untouched instead of expanding them", () => {
    expect(decodeXmlEntities("&nbsp;&bogus;&#0;")).toBe("&nbsp;&bogus;&#0;");
  });

  it("rejects DOCTYPE declarations (no custom entities)", () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "aaaa">]><x>&a;</x>')).toThrow(XmlParseError);
  });

  it.each([
    ["", "No root element"],
    ["not xml at all", "Text outside the root element"],
    ["<a><b></a></b>", "Mismatched closing tag"],
    ["<a><b></b>", "Unclosed element"],
    ["<a></a><b></b>", "More than one root element"],
    ["<a><!-- never ends</a>", "Unterminated comment"],
    ["<a", "Unterminated tag"],
  ])("rejects malformed input %#", (input, message) => {
    expect(() => parseXml(input)).toThrow(message);
  });

  it("rejects absurdly deep nesting", () => {
    expect(() => parseXml("<a>".repeat(150) + "</a>".repeat(150))).toThrow("nested too deeply");
  });
});
