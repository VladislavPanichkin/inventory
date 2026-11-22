import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "inventory-app";
export default defineRailway(() => {
  const inventoryApp = service("inventory-app", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/v1/health",
    healthcheckTimeout: 120,
    replicas: { "europe-west4-drams3a": 1 },
  });

  return project("inventory", {
    variables: { managed: false },
    resources: [inventoryApp],
  });
});
