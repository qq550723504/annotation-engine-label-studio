import { ImageView, Labels, LabelStudio } from "@humansignal/frontend-test/helpers/LSF";

describe("standalone editor locale", () => {
  it("localizes the default empty state in place", () => {
    LabelStudio.init({
      locale: "en-US",
      config: "<View></View>",
      task: { id: 800, data: {}, annotations: [], predictions: [] },
    });
    cy.contains("No more annotations").should("be.visible");
    cy.window().then((win: any) => {
      const editor = [...win.LabelStudio.instances][0];
      expect(editor.setLocale("zh-CN")).to.eq(true);
    });
    cy.contains("没有更多标注").should("be.visible");
  });

  it("keeps a text choice and selected annotation while switching display language", () => {
    const submit = cy.spy().as("submit");
    const update = cy.spy().as("update");
    LabelStudio.params()
      .config('<View><Text name="text" value="$text"/><Choices name="sentiment" toName="text"><Choice value="Positive"/><Choice value="Negative"/></Choices></View>')
      .data({ text: "Raw text 日本語" })
      .withResult([])
      .withParam("locale", "en-US")
      .withParam("onSubmitAnnotation", submit)
      .withParam("onUpdateAnnotation", update)
      .init();
    cy.contains(".ant-checkbox-wrapper", "Positive").click();
    cy.get('[data-testid="bottombar-update-button"]').should("contain.text", "Update");
    let editor: any;
    let selected: any;
    let result: string;
    cy.window().then((win: any) => {
      editor = [...win.LabelStudio.instances][0];
      selected = win.Htx.annotationStore.selected;
      result = JSON.stringify(selected.serializeAnnotation());
      expect(result).to.contain("Positive");
      expect(selected.history.canUndo).to.eq(true);
      expect(editor.setLocale("zh-CN")).to.eq(true);
    });
    cy.get('[data-testid="bottombar-update-button"]').should("contain.text", "更新");
    cy.get("#Regions-draggable").should("contain.text", "区域");
    cy.contains("Raw text 日本語").should("be.visible");
    cy.window().then((win: any) => {
      expect([...win.LabelStudio.instances][0]).to.eq(editor);
      expect(win.Htx.annotationStore.selected).to.eq(selected);
      expect(JSON.stringify(selected.serializeAnnotation())).to.eq(result);
      expect(selected.history.canUndo).to.eq(true);
      expect(editor.localeRuntime.locale).to.eq("zh-CN");
      expect(editor.setLocale("xx-invalid")).to.eq(false);
      expect(editor.localeRuntime.locale).to.eq("zh-CN");
    });
    cy.get("@submit").should("not.have.been.called");
    cy.get("@update").should("not.have.been.called");
  });

  it("keeps an image region and history state while switching display language", () => {
    const submit = cy.spy().as("submit");
    const update = cy.spy().as("update");
    LabelStudio.params()
      .config('<View><Image name="image" value="$image"/><RectangleLabels name="label" toName="image"><Label value="Object"/></RectangleLabels></View>')
      .data({ image: "/public/files/images/nick-owuor-unsplash.jpg" })
      .withResult([])
      .withParam("locale", "en-US")
      .withParam("onSubmitAnnotation", submit)
      .withParam("onUpdateAnnotation", update)
      .init();
    ImageView.waitForImage();
    Labels.select("Object");
    ImageView.drawRect(20, 20, 100, 100);
    cy.get('[data-testid="bottombar-update-button"]').should("contain.text", "Update");
    let editor: any;
    let selected: any;
    let result: string;
    let canUndo: boolean;
    cy.window().then((win: any) => {
      editor = [...win.LabelStudio.instances][0];
      selected = win.Htx.annotationStore.selected;
      result = JSON.stringify(selected.serializeAnnotation());
      canUndo = selected.history.canUndo;
      expect(result).to.contain("Object");
      expect(canUndo).to.eq(true);
      expect(editor.setLocale("zh-CN")).to.eq(true);
    });
    cy.get('[data-testid="bottombar-update-button"]').should("contain.text", "更新");
    cy.window().then((win: any) => {
      expect([...win.LabelStudio.instances][0]).to.eq(editor);
      expect(win.Htx.annotationStore.selected).to.eq(selected);
      expect(JSON.stringify(selected.serializeAnnotation())).to.eq(result);
      expect(selected.history.canUndo).to.eq(canUndo);
    });
    cy.get("@submit").should("not.have.been.called");
    cy.get("@update").should("not.have.been.called");
  });
});
