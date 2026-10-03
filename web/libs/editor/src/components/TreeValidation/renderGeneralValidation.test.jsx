import React from "react";
import { render, screen } from "@testing-library/react";
import DefaultMessages from "../../utils/messages";
import { renderGeneralValidation } from "./renderGeneralValidation";

it("preserves built-in validation emphasis and actionable help links", () => {
  const message = DefaultMessages.ERR_LOADING_HTTP({
    attr: "$image",
    url: "https://example.test/image.png",
    error: "HTTP 403",
  });
  render(<div>{renderGeneralValidation(message)}</div>);
  expect(screen.getByText("$image").tagName).toBe("CODE");
  const link = screen.getByRole("link", { name: "more on that here" });
  expect(link).toHaveAttribute("href", DefaultMessages.URL_CORS_DOCS);
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByRole("link", { name: "https://example.test/image.png" })).toHaveAttribute("href", "https://example.test/image.png");
});

it("strips executable markup and unsafe links from dynamic error text", () => {
  const message = '<p>Network failed <img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">unsafe</a></p>';
  const { container } = render(<div>{renderGeneralValidation(message)}</div>);
  expect(screen.getByText(/Network failed/)).toBeInTheDocument();
  expect(container.querySelector("img,script,[onerror]")).toBeNull();
  expect(screen.getByText("unsafe")).not.toHaveAttribute("href");
});

it("keeps a structured upstream React message", () => {
  render(<div>{renderGeneralValidation(<p>Audio error</p>)}</div>);
  expect(screen.getByText("Audio error").tagName).toBe("P");
});
