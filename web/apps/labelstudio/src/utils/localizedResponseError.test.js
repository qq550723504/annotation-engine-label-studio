import { localizedResponseErrorDetails } from "./localizedResponseError";

const rejectedImport = (language, status = 400) => ({
  response: {
    detail: "The CSV header is invalid.",
    validation_errors: { data: ["Column 'text' is required."] },
    exc_info: "internal traceback must stay hidden",
  },
  $meta: { status, headers: new Map([["content-language", language]]) },
});

describe("import error display", () => {
  it("keeps actionable validation details when the server response matches the active locale", () => {
    const message = localizedResponseErrorDetails(rejectedImport("en-US"), "en-US");
    expect(message).toContain("The CSV header is invalid.");
    expect(message).toContain("data: Column 'text' is required.");
    expect(message).not.toContain("internal traceback");
  });

  it("uses the controlled fallback for stale, unlabelled, or server-failure responses", () => {
    expect(localizedResponseErrorDetails(rejectedImport("en-US"), "zh-CN")).toBeNull();
    expect(localizedResponseErrorDetails({ response: { detail: "English only" }, $meta: { status: 400 } }, "zh-CN"))
      .toBeNull();
    expect(localizedResponseErrorDetails(rejectedImport("en-US", 500), "en-US")).toBeNull();
  });

  it("preserves project field validation without exposing unrelated server fields", () => {
    const error = {
      response: {
        validation_errors: { title: ["The project name is too long."] },
        extra: { debug: "internal data" },
        exc_info: "traceback",
      },
      $meta: { status: 400, headers: new Map([["content-language", "en-US"]]) },
    };
    expect(localizedResponseErrorDetails(error, "en-US")).toBe("title: The project name is too long.");
    expect(localizedResponseErrorDetails(error, "zh-CN")).toBeNull();
  });
});
