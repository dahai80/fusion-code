import { afterEach, describe, expect, it } from "bun:test";
import { defaultRegistryUrl } from "../../utils/plugins/registryIndex.js";

const ORIG = process.env.FUSION_CODE_PLUGIN_REGISTRY_URL;
afterEach(() => {
    if (ORIG === undefined) delete process.env.FUSION_CODE_PLUGIN_REGISTRY_URL;
    else process.env.FUSION_CODE_PLUGIN_REGISTRY_URL = ORIG;
});

describe("defaultRegistryUrl (P0-3 supply-chain)", () => {
    it("returns the official https registry when no override", () => {
        delete process.env.FUSION_CODE_PLUGIN_REGISTRY_URL;
        const url = defaultRegistryUrl();
        expect(url.startsWith("https://")).toBe(true);
    });

    it("accepts an https override", () => {
        process.env.FUSION_CODE_PLUGIN_REGISTRY_URL =
            "https://example.com/registry.json";
        expect(defaultRegistryUrl()).toBe("https://example.com/registry.json");
    });

    it("accepts a loopback http override (local testing)", () => {
        process.env.FUSION_CODE_PLUGIN_REGISTRY_URL =
            "http://localhost:8080/registry.json";
        expect(defaultRegistryUrl()).toBe("http://localhost:8080/registry.json");
    });

    it("accepts a 127.0.0.1 loopback http override", () => {
        process.env.FUSION_CODE_PLUGIN_REGISTRY_URL =
            "http://127.0.0.1:8080/registry.json";
        expect(defaultRegistryUrl()).toBe("http://127.0.0.1:8080/registry.json");
    });

    it("rejects a non-loopback plaintext http override", () => {
        process.env.FUSION_CODE_PLUGIN_REGISTRY_URL =
            "http://evil.example.com/registry.json";
        // P0-3: plaintext remote registry can be tampered in transit; sha256
        // pins fetched in the clear prove nothing — fail visibly.
        expect(() => defaultRegistryUrl()).toThrow(/HTTPS/);
    });

    it("rejects a plaintext http IP override (non-loopback)", () => {
        process.env.FUSION_CODE_PLUGIN_REGISTRY_URL =
            "http://10.0.0.1/registry.json";
        expect(() => defaultRegistryUrl()).toThrow(/HTTPS/);
    });
});
