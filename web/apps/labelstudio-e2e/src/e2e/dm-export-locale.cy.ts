/// <reference types="cypress" />

type Fixture = {
  password: string;
  project_id: number;
  users: { manager: { email: string } };
};

describe("Data Manager export locale", () => {
  let fixture: Fixture;

  before(() => {
    cy.readFile(".enterprise-e2e.json").then((data) => { fixture = data as Fixture; });
  });

  const chooseLocale = (locale: "en-US" | "zh-CN") => {
    cy.loginAs(fixture.users.manager.email, fixture.password, "/user/account/personal-info");
    cy.get('[data-testid="language-preference-select"]').then(($select) => {
      if ($select.val() !== locale) cy.wrap($select).select(locale);
    });
    cy.get("html").should("have.attr", "lang", locale);
  };

  for (const [locale, copy] of [
    ["en-US", { heading: "Export data", format: "COCO with Images", description: "COCO format with the images included." }],
    ["zh-CN", { heading: "导出数据", format: "COCO（含图像）", description: "包含图像文件的 COCO 格式。" }],
  ] as const) {
    it(`keeps the converter format ID and downloaded bytes while displaying ${locale}`, () => {
      chooseLocale(locale);
      cy.intercept({ method: "GET", pathname: `/api/projects/${fixture.project_id}/export/formats` }, [
        { name: "JSON", title: "JSON", description: "Raw JSON", tags: [] },
        { name: "COCO_WITH_IMAGES", title: "COCO with Images", description: "COCO format with images downloaded.", tags: ["image segmentation"] },
      ]).as("formats");
      cy.intercept({ method: "GET", pathname: `/api/projects/${fixture.project_id}/export` }, (request) => {
        expect(request.query.exportType).to.eq("COCO_WITH_IMAGES");
        request.reply({
          statusCode: 200,
          headers: { "content-type": "application/octet-stream", filename: "synthetic-export.json" },
          body: "synthetic-export-bytes",
        });
      }).as("download");

      cy.visit(`/projects/${fixture.project_id}/data/export`);
      cy.wait("@formats");
      cy.get(`[aria-label="${copy.heading}"]`).should("be.visible");
      cy.get('[data-testid="export-format-COCO_WITH_IMAGES"]')
        .should("contain.text", copy.format)
        .and("contain.text", copy.description)
        .focus().type("{enter}")
        .should("have.attr", "aria-pressed", "true");

      let downloadedName = "";
      let downloadedBlob: Blob | undefined;
      cy.window().then((win: any) => {
        cy.stub(win.URL, "createObjectURL").callsFake((blob: Blob) => {
          downloadedBlob = blob;
          return "blob:synthetic-export";
        });
        cy.stub(win.HTMLAnchorElement.prototype, "click").callsFake(function (this: HTMLAnchorElement) {
          downloadedName = this.download;
        });
      });
      cy.get(`[aria-label="${copy.heading}"]`).click();
      cy.wait("@download");
      cy.then(async () => {
        expect(downloadedName).to.eq("synthetic-export.json");
        expect(await downloadedBlob?.text()).to.eq("synthetic-export-bytes");
      });
    });
  }

  it("shows Chinese timeout guidance without changing the CLI command", () => {
    chooseLocale("zh-CN");
    cy.intercept({ method: "GET", pathname: `/api/projects/${fixture.project_id}/export/formats` }, [
      { name: "JSON", title: "JSON", description: "Raw JSON", tags: [] },
    ]);
    cy.intercept({ method: "GET", pathname: `/api/projects/${fixture.project_id}/export` }, {
      statusCode: 504,
      body: "synthetic timeout",
    }).as("exportTimeout");
    cy.visit(`/projects/${fixture.project_id}/data/export`);
    cy.get('[aria-label="导出数据"]').click();
    cy.wait("@exportTimeout");
    cy.get("body").should("contain.text", "导出超时");
    cy.get("code").should("have.text", `label-studio export ${fixture.project_id} JSON --export-path=<output-path>`);
  });

  it("does not crash when the format list is unavailable", () => {
    chooseLocale("zh-CN");
    cy.intercept({ method: "GET", pathname: `/api/projects/${fixture.project_id}/export/formats` }, {
      statusCode: 503,
      body: { detail: "synthetic unavailable" },
    }).as("formatsUnavailable");
    cy.visit(`/projects/${fixture.project_id}/data/export`);
    cy.wait("@formatsUnavailable");
    cy.get('[aria-label="导出数据"]').should("exist");
    cy.get('[data-testid^="export-format-"]').should("not.exist");
  });
});
