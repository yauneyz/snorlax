import { describe, expect, it } from "vitest";
import {
  resolveCompMode,
  selectCompEnvironment,
} from "../../scripts/comp-environment";

const credentials = {
  app: {
    url_dev: "http://localhost:3000",
    url_prod: "https://talysman.app",
  },
  supabase: {
    dev: {
      url: "http://127.0.0.1:54321",
      secret_key: "dev-secret",
    },
    prod: {
      url: "https://project.supabase.co",
      secret_key: "prod-secret",
    },
  },
};

describe("comp CLI environment selection", () => {
  it("targets production by default", () => {
    expect(resolveCompMode({})).toBe("prod");
    expect(selectCompEnvironment(credentials, "prod")).toMatchObject({
      label: "production",
      appUrl: "https://talysman.app",
      supabaseUrl: "https://project.supabase.co",
      secretKey: "prod-secret",
    });
  });

  it("targets local Supabase only when --dev is present", () => {
    expect(resolveCompMode({ dev: true })).toBe("dev");
    expect(selectCompEnvironment(credentials, "dev")).toMatchObject({
      label: "local development",
      appUrl: "http://localhost:3000",
      supabaseUrl: "http://127.0.0.1:54321",
      secretKey: "dev-secret",
    });
  });

  it("refuses a local production target", () => {
    expect(() =>
      selectCompEnvironment(
        {
          ...credentials,
          supabase: { ...credentials.supabase, prod: credentials.supabase.dev },
        },
        "prod",
      ),
    ).toThrow("[supabase.prod] points at local Supabase");
  });

  it("refuses a hosted --dev target", () => {
    expect(() =>
      selectCompEnvironment(
        {
          ...credentials,
          supabase: { ...credentials.supabase, dev: credentials.supabase.prod },
        },
        "dev",
      ),
    ).toThrow("--dev may only use local Supabase");
  });
});
