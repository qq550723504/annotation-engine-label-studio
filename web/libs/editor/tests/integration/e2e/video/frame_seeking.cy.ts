import { LabelStudio, VideoView } from "@humansignal/frontend-test/helpers/LSF/index";
import { simpleVideoConfig } from "../../data/video_segmentation/regions";
import { FF_VIDEO_FRAME_SEEK_PRECISION } from "libs/editor/src/utils/feature-flags";

const simpleVideoData = { video: "/public/files/fps_24_frames_24_video.webm" };

describe("Video Frame Seeking", () => {
  beforeEach(() => {
    LabelStudio.addFeatureFlagsOnPageLoad({
      [FF_VIDEO_FRAME_SEEK_PRECISION]: true,
    });
  });

  it("Should be able to seek to a specific frame and see the correct frame without duplicating or skipping frames", () => {
    LabelStudio.params().config(simpleVideoConfig).data(simpleVideoData).withResult([]).init();

    LabelStudio.waitForObjectsReady();

    let previousFrame: { pixels: string; width: number; height: number };
    const videoCanvas = () => VideoView.videoCanvas.find<HTMLCanvasElement>("canvas").should("have.length", 1);

    VideoView.waitForFrame(1);
    VideoView.timeframesArea.scrollIntoView();
    VideoView.waitForStableState();
    videoCanvas().then(($canvas) => {
      const canvas = $canvas[0];
      expect(canvas.width, "rendered canvas width").to.be.greaterThan(0);
      expect(canvas.height, "rendered canvas height").to.be.greaterThan(0);
      previousFrame = { pixels: canvas.toDataURL(), width: canvas.width, height: canvas.height };
    });

    for (const frame of [2, 3, 4]) {
      VideoView.clickAtFrame(frame);
      VideoView.frameCounter.invoke("text").should("match", new RegExp(`^${frame} of \\d+$`));

      // Compare the rendered pixels directly: DOM screenshots can be clipped by fixed controls.
      videoCanvas()
        .should(($canvas) => {
          const canvas = $canvas[0];
          expect(canvas.width, "canvas width stays constant").to.eq(previousFrame.width);
          expect(canvas.height, "canvas height stays constant").to.eq(previousFrame.height);
          expect(canvas.toDataURL() !== previousFrame.pixels, `frame ${frame} pixels changed`).to.eq(true);
        })
        .then(($canvas) => {
          previousFrame.pixels = $canvas[0].toDataURL();
        });
    }
  });
});
