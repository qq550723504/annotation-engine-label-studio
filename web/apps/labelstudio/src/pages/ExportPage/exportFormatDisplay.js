// The converter owns format IDs and capabilities. This allowlist changes only
// their presentation; callers must keep using the original format object.
const descriptionKeys = {
  JSON: "exportFormatJSONDescription",
  JSON_MIN: "exportFormatJSONMINDescription",
  CSV: "exportFormatCSVDescription",
  TSV: "exportFormatTSVDescription",
  CONLL2003: "exportFormatCONLL2003Description",
  COCO: "exportFormatCOCODescription",
  COCO_WITH_IMAGES: "exportFormatCOCOWithImagesDescription",
  VOC: "exportFormatVOCDescription",
  YOLO: "exportFormatYOLODescription",
  YOLO_WITH_IMAGES: "exportFormatYOLOWithImagesDescription",
  YOLO_OBB: "exportFormatYOLOOBBDescription",
  YOLO_OBB_WITH_IMAGES: "exportFormatYOLOOBBWithImagesDescription",
  BRUSH_TO_NUMPY: "exportFormatBrushNumpyDescription",
  BRUSH_TO_PNG: "exportFormatBrushPNGDescription",
  ASR_MANIFEST: "exportFormatASRDescription",
  BRUSH_TO_COCO: "exportFormatBrushCOCODescription",
};

const titleKeys = {
  COCO_WITH_IMAGES: "exportFormatCOCOWithImagesTitle",
  YOLO_WITH_IMAGES: "exportFormatYOLOWithImagesTitle",
  YOLO_OBB_WITH_IMAGES: "exportFormatYOLOOBBWithImagesTitle",
  BRUSH_TO_NUMPY: "exportFormatBrushNumpyTitle",
  BRUSH_TO_PNG: "exportFormatBrushPNGTitle",
  BRUSH_TO_COCO: "exportFormatBrushCOCOTitle",
  ASR_MANIFEST: "exportFormatASRTitle",
};

const tagKeys = {
  "sequence labeling": "exportTagSequenceLabeling",
  "text tagging": "exportTagTextTagging",
  "named entity recognition": "exportTagNamedEntityRecognition",
  "image segmentation": "exportTagImageSegmentation",
  "object detection": "exportTagObjectDetection",
  keypoints: "exportTagKeypoints",
  "speech recognition": "exportTagSpeechRecognition",
  "brush annotations": "exportTagBrushAnnotations",
};

export const displayExportFormat = (format, runtime) => {
  const translate = (key, fallback) => key ? runtime.tDynamic(`datamanager:${key}`) : fallback;

  return {
    title: translate(titleKeys[format.name], format.title),
    description: translate(descriptionKeys[format.name], format.description),
    tags: format.tags?.map((tag) => translate(tagKeys[tag], tag)) ?? [],
  };
};
