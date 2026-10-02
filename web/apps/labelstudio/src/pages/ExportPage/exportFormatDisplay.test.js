import { createLocaleRuntime } from "@humansignal/i18n";
import { displayExportFormat } from "./exportFormatDisplay";

describe("export format display", () => {
  it("changes converter copy without changing the format ID or API metadata", () => {
    const format = Object.freeze({
      name: "COCO_WITH_IMAGES",
      title: "COCO with Images",
      description: "COCO format with images downloaded.",
      tags: Object.freeze(["image segmentation", "object detection"]),
      disabled: false,
    });
    const runtime = createLocaleRuntime("en-US");

    expect(displayExportFormat(format, runtime).title).toBe("COCO with Images");
    expect(runtime.updateLocale("zh-CN")).toBe(true);
    expect(displayExportFormat(format, runtime)).toEqual({
      title: "COCO（含图像）",
      description: "包含图像文件的 COCO 格式。",
      tags: ["图像分割", "目标检测"],
    });
    expect(format.name).toBe("COCO_WITH_IMAGES");
    expect(format.description).toBe("COCO format with images downloaded.");
    expect(format.tags).toEqual(["image segmentation", "object detection"]);
    runtime.destroy();
  });

  it("preserves unknown converter metadata as supplied", () => {
    const runtime = createLocaleRuntime("zh-CN");
    const format = { name: "FUTURE_FORMAT", title: "Future format", description: "Future details", tags: ["future"] };

    expect(displayExportFormat(format, runtime)).toEqual({
      title: "Future format",
      description: "Future details",
      tags: ["future"],
    });
    runtime.destroy();
  });
});
