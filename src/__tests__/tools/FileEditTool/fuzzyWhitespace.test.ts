import { describe, expect, test } from "bun:test";
import {
	findActualString,
	findFuzzyWhitespaceMatch,
	rebalanceIndent,
} from "../../../tools/FileEditTool/utils.js";

describe("findFuzzyWhitespaceMatch", () => {
	test("direct fuzzy call also matches when string is present exactly", () => {
		const file = "const a = 1;\nconst b = 2;\n";
		expect(findFuzzyWhitespaceMatch(file, "const a = 1;")).toBe("const a = 1;");
	});

	test("recovers wrong indentation on a multi-line block", () => {
		const file = "function f() {\n    if (x) {\n        return 1;\n    }\n}\n";
		const modelOld = "if (x) {\n    return 1;\n}";
		const got = findFuzzyWhitespaceMatch(file, modelOld);
		expect(got).toBe("    if (x) {\n        return 1;\n    }");
	});

	test("recovers trailing whitespace differences", () => {
		const file = "foo(1, 2);   \nbar(3);";
		const got = findFuzzyWhitespaceMatch(file, "foo(1, 2);\nbar(3);");
		expect(got).toBe("foo(1, 2);   \nbar(3);");
	});

	test("recovers internal whitespace-run differences", () => {
		const file = "const x    = compute(a,  b);";
		const got = findFuzzyWhitespaceMatch(file, "const x = compute(a, b);");
		expect(got).toBe("const x    = compute(a,  b);");
	});

	test("handles CRLF file content", () => {
		const file = "if (a) {\r\n    doIt();\r\n}\r\n";
		const got = findFuzzyWhitespaceMatch(file, "if (a) {\n    doIt();\n}");
		expect(got).toBe("if (a) {\r\n    doIt();\r\n}");
	});

	test("returns null on ambiguous (multiple) fuzzy matches", () => {
		const file =
			"    if (x) {\n        go();\n    }\n\n    if (x) {\n        go();\n    }\n";
		expect(findFuzzyWhitespaceMatch(file, "if (x) {\n    go();\n}")).toBeNull();
	});

	test("single-line match does not match a prefix of a longer line", () => {
		const file = "function calculateTotal() {}\n";
		expect(findFuzzyWhitespaceMatch(file, "calculateTotal")).toBe(
			"calculateTotal",
		);
		expect(findFuzzyWhitespaceMatch(file, "calculateTotalAndMore")).toBeNull();
	});

	test("empty or whitespace-only search returns null", () => {
		expect(findFuzzyWhitespaceMatch("anything", "   ")).toBeNull();
		expect(findFuzzyWhitespaceMatch("anything", "")).toBeNull();
	});

	test("regex special characters are escaped", () => {
		const file = "const re = /a.b+c/;\n";
		const got = findFuzzyWhitespaceMatch(file, "const re = /a.b+c/;");
		expect(got).toBe("const re = /a.b+c/;");
	});

	test("blank lines in the search block match blank lines in the file", () => {
		const file = "a();\n\nb();\n";
		const got = findFuzzyWhitespaceMatch(file, "a();\n\nb();");
		expect(got).toBe("a();\n\nb();");
	});

	test("findActualString exact tier returns substring verbatim", () => {
		const file = "    return value;\n";
		expect(findActualString(file, "return value")).toBe("return value");
	});

	test("findActualString falls through to fuzzy for an indented block", () => {
		const file = "function f() {\n    if (x) {\n        return 1;\n    }\n}\n";
		expect(findActualString(file, "if (x) {\n    return 1;\n}")).toBe(
			"    if (x) {\n        return 1;\n    }",
		);
	});
});

describe("rebalanceIndent", () => {
	test("no-op when strings identical", () => {
		expect(rebalanceIndent("a", "a", "b")).toBe("b");
	});

	test("no-op for single-line blocks (inline replacement)", () => {
		expect(rebalanceIndent("foo", "    foo", "bar")).toBe("bar");
	});

	test("adds file indentation to every new_string line", () => {
		const modelOld = "if (x) {\n    go();\n}";
		const actualOld = "    if (x) {\n        go();\n    }";
		const newStr = "if (x) {\n    stop();\n}";
		expect(rebalanceIndent(modelOld, actualOld, newStr)).toBe(
			"    if (x) {\n        stop();\n    }",
		);
	});

	test("dedents when the model over-indented", () => {
		const modelOld = "        if (x) {\n            go();\n        }";
		const actualOld = "    if (x) {\n        go();\n    }";
		const newStr = "        if (x) {\n            stop();\n        }";
		expect(rebalanceIndent(modelOld, actualOld, newStr)).toBe(
			"    if (x) {\n        stop();\n    }",
		);
	});

	test("leaves blank lines untouched", () => {
		const modelOld = "a() {\n\n    b();\n}";
		const actualOld = "    a() {\n\n        b();\n    }";
		const newStr = "c() {\n\n    d();\n}";
		expect(rebalanceIndent(modelOld, actualOld, newStr)).toBe(
			"    c() {\n\n        d();\n    }",
		);
	});

	test("returns new_string unchanged when delta is not a pure indent shift", () => {
		const modelOld = "if (x) {\n    go();\n}";
		const actualOld = "    if (x) {\n    go();\n    }";
		const newStr = "if (x) {\n    stop();\n}";
		expect(rebalanceIndent(modelOld, actualOld, newStr)).toBe(newStr);
	});

	test("preserves trailing newline of new_string", () => {
		const modelOld = "if (x) {\n    go();\n}\n";
		const actualOld = "    if (x) {\n        go();\n    }\n";
		const newStr = "if (x) {\n    stop();\n}\n";
		expect(rebalanceIndent(modelOld, actualOld, newStr)).toBe(
			"    if (x) {\n        stop();\n    }\n",
		);
	});
});
