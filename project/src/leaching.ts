import { fromUrl } from 'geotiff';

// The original 32-bit classified raster, not the Mapbox tileset (pkotzzneagcrc.8uf3g8) - that
// tileset's 8-bit conversion truncated the source 0/1 values straight through (no contrast
// stretch), and Mapbox always serves raster tilesets as lossy jpg/webp, so reading pixel colors
// back off the rendered map tiles isn't reliable for an exact true/false answer. The source file
// is tiny (408x337 cells) so we fetch and decode it directly instead.
const LEACHING_TIF_URL = '/map-data/leaching-map-original.tif';

type LeachingRaster = {
  data: Float32Array;
  width: number;
  height: number;
  originX: number;
  originY: number;
  pixelWidth: number;
  pixelHeight: number;
  noDataValue: number | null;
};

let rasterPromise: Promise<LeachingRaster> | null = null;

function loadRaster(): Promise<LeachingRaster> {
  if (!rasterPromise) {
    rasterPromise = (async () => {
      const tiff = await fromUrl(LEACHING_TIF_URL);
      const image = await tiff.getImage();
      const [originX, originY] = image.getOrigin();
      const [pixelWidth, pixelHeight] = image.getResolution();
      const rasters = await image.readRasters({ interleave: false });
      return {
        data: rasters[0] as Float32Array,
        width: image.getWidth(),
        height: image.getHeight(),
        originX,
        originY,
        pixelWidth,
        pixelHeight,
        noDataValue: image.getGDALNoData(),
      };
    })();
  }
  return rasterPromise;
}

/**
 * Look up whether the soil leaching zone raster flags a point as at-risk.
 * @returns true/false if the point falls inside the classified extent, or null if it's outside
 * the raster's bounds or in a NoData cell (e.g. ocean, or outside the study area).
 */
export async function getLeachingRisk(lng: number, lat: number): Promise<boolean | null> {
  const { data, width, height, originX, originY, pixelWidth, pixelHeight, noDataValue } = await loadRaster();

  const col = Math.floor((lng - originX) / pixelWidth);
  const row = Math.floor((lat - originY) / pixelHeight);
  if (col < 0 || col >= width || row < 0 || row >= height) return null;

  const value = data[row * width + col];
  // NoData sentinel is a huge-magnitude float (-3.4028235e+38) - a loose comparison is fine
  // since valid values are always 0 or 1, nowhere near that magnitude.
  if (noDataValue !== null && Math.abs(value - noDataValue) < 1) return null;

  return value >= 0.5;
}
