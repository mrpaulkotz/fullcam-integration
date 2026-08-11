# Mapbox Weather Station Map

A TypeScript web application built with Vite that displays an interactive map using Mapbox GL JS, showing weather stations and allowing users to draw polygons and points to get weather data.

## Features

- Interactive map with Mapbox GL JS
- Drawing tools for points and polygons
- Weather station data visualization (rainfall and max temperature)
- Year selection (2020-2024)
- Find nearest weather stations to drawn features
- Calculate polygon areas and centroids
- Geocoding to identify Australian states
- Toggle between street and satellite map views

## Project Structure

```
project/
├── src/
│   ├── main.ts           # Application entry point
│   ├── map.ts            # Map initialization and event handlers
│   ├── weather.ts        # Weather station lookup functions
│   ├── calculations.ts   # Geometric calculations (area, distance, centroid)
│   ├── data.ts           # Weather data (temperature and rainfall)
│   ├── types.ts          # TypeScript type definitions
│   └── style.css         # Application styles
├── index.html            # HTML template
├── package.json          # Dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

## Installation

1. Install dependencies:

```bash
npm install
```

2. Set up environment variables:

```bash
# Copy the example env file
cp .env.example .env
```

3. Edit `.env` and add your Mapbox access token:

```
VITE_MAPBOX_ACCESS_TOKEN=your_mapbox_token_here
```

Get your Mapbox token from [https://account.mapbox.com/access-tokens/](https://account.mapbox.com/access-tokens/)

## Development

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:5173/`

## Build

Build for production:

```bash
npm run build
```

## Preview

Preview the production build:

```bash
npm run preview
```

## Deployment to AWS Amplify

### Option 1: Deploy from Git Repository

1. **Push your code to a Git repository** (GitHub, GitLab, or Bitbucket)

2. **Sign in to AWS Amplify Console**:
   - Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
   - Click "New app" → "Host web app"

3. **Connect your repository**:
   - Select your Git provider
   - Authorize AWS Amplify
   - Choose your repository and branch

4. **Configure build settings**:
   - Amplify will auto-detect the `amplify.yml` configuration
   - Review the build settings (already configured in this project)

5. **Add environment variables**:
   - In Amplify Console, go to "Environment variables"
   - Add `VITE_MAPBOX_ACCESS_TOKEN` with your Mapbox token
   - Add `VITE_FULLCAM_SUBSCRIPTION_KEY` with your FullCAM API key
   - Add `VITE_API_PROXY_URL` with your deployed proxy server URL (see Backend Proxy section below)

6. **Deploy**:
   - Click "Save and deploy"
   - Amplify will build and deploy your app
   - You'll get a URL like `https://main.xxxxx.amplifyapp.com`

### Option 2: Manual Deploy

1. Build the project locally:

```bash
npm run build
```

2. Deploy the `dist/` folder using Amplify CLI:

```bash
npm install -g @aws-amplify/cli
amplify configure
amplify init
amplify publish
```

### Setting up Custom Domain

1. In Amplify Console, go to "Domain management"
2. Add your custom domain
3. Follow DNS configuration instructions
4. Amplify will provision SSL certificate automatically

## Technologies

- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool and dev server
- **Mapbox GL JS** - Interactive maps
- **Mapbox GL Draw** - Drawing tools for maps

## Usage

1. Use the drawing tools to add points or polygons to the map
2. Select a year from the dropdown
3. Click on drawn features to view:
   - Coordinates or area
   - Australian state
   - Nearest rainfall monitoring station with annual rainfall data
   - Nearest max temperature monitoring station with temperature data
4. Toggle between street and satellite views using the button

## Host App Integration

This map keeps no storage of its own. If another web app embeds this map in the same window/page (i.e. calls `initializeMap()` directly, not via an iframe), it's responsible for:

1. Listening for the `fullcam-location-selected` event and saving whatever it needs from it.
2. Passing that saved data back into `initializeMap()` on the next page load, so the map re-renders the same point, polygon, or parcel selection and re-runs its full lookup pipeline (weather, elevation, state, SA4/SA2 region, `Cattle_Reg`).

Both `initializeMap` and the types below are exported from `src/map.ts`.

### 1. Listening for selections

Every time the user drops a point, finishes drawing a polygon, or clicks "Use this boundary" after selecting cadastral parcels, the map dispatches a `CustomEvent` on `window`:

```ts
import type { LocationSelectionDetail } from './map'; // or wherever map.ts is imported from

window.addEventListener('fullcam-location-selected', (e: CustomEvent<LocationSelectionDetail | null>) => {
  const detail = e.detail;
  if (!detail) {
    // User cleared their selection (deleted the drawn feature / deselected all parcels).
    // Clear whatever you saved for this map.
    return;
  }
  // ... save what you need, see below
});
```

`detail` is `null` when the selection is cleared (all drawn features deleted, or parcel selection emptied) — always handle this case, not just the populated one.

#### `LocationSelectionDetail` field reference

| Field | Type | Notes |
|---|---|---|
| `kind` | `'point' \| 'polygon' \| 'parcels'` | What kind of selection this is. |
| `latitude`, `longitude` | `number` | The point's coordinates, or the polygon/parcels' centroid. |
| `mapView` | `{ center: [lng, lat]; zoom: number }` | The map's pan/zoom at the moment of this selection. Save this alongside the geometry/parcelKeys and pass it back as `SavedLocationSelection.mapView` so the map opens at the same view instead of the default Australia-wide zoom. |
| `geometry` | GeoJSON `Point \| Polygon \| MultiPolygon` | The actual shape. Present for all kinds, but you only need to save it for `point`/`polygon` — see below. |
| `state` | `string \| null` | Australian state/territory name. |
| `sa4Name`, `sa2Name` | `string \| null` | ABS SA4/SA2 region names, if the boundary tileset has loaded at the current zoom. |
| `cattleReg` | `string \| null` | Cattle disease-risk region classification, if available for that SA2. |
| `parcelIds` | `string[]` (optional) | **Display-only** human-readable parcel labels, e.g. `"QLD 3RP91637"`. Only present for `kind: 'parcels'`. Don't use these to restore a selection — they aren't guaranteed unique/stable. |
| `parcelKeys` | `string[]` (optional) | **Stable** `"STATE:objectid"` identifiers for each selected parcel, e.g. `"QLD:2192036"`. Only present for `kind: 'parcels'`. **This is what you save to restore a parcel selection.** |
| `elevation` | `number \| null` | Metres, from Mapbox terrain data. |
| `selectedYears` | `string[]` | Which years were selected in the year picker when this lookup ran. |
| `weatherDataByYear` | `{ year: string; weatherData: SiloWeatherData \| null }[]` | SILO weather data per selected year. |
| `nearestRainfallSite`, `nearestMaxTempSite` | `{ stationName, id, distance } \| null` | Nearest monitoring stations. |
| `areaSquareMeters`, `areaHectares` | `number` (optional) | Only present for `kind: 'polygon'` / `'parcels'`. |
| `summary` | `string` | Plain-text version of everything shown in the on-map info panel. |

### 2. Saving a selection

Save different fields depending on `kind` — for `point`/`polygon` you need the geometry; for `parcels` you need `parcelKeys` (not the geometry, and not `parcelIds`):

```ts
window.addEventListener('fullcam-location-selected', (e: CustomEvent<LocationSelectionDetail | null>) => {
  const detail = e.detail;
  if (!detail) {
    localStorage.removeItem('mapSelection');
    return;
  }

  const toSave =
    detail.kind === 'parcels'
      ? { kind: 'parcels' as const, parcelKeys: detail.parcelKeys ?? [], mapView: detail.mapView }
      : { kind: detail.kind, geometry: detail.geometry, mapView: detail.mapView };

  localStorage.setItem('mapSelection', JSON.stringify(toSave));
});
```

(`localStorage` is just an example — save it however your app persists state: a database, a query param, etc.)

`mapView` is optional on `SavedLocationSelection` — you can leave it out if you only care about restoring the selection itself and are fine with the map picking its own default view.

### 3. Restoring a selection

Pass the saved object straight into `initializeMap()` as `initialSelection`:

```ts
import { initializeMap } from './map';
import type { SavedLocationSelection } from './map';

const raw = localStorage.getItem('mapSelection');
const savedSelection: SavedLocationSelection | undefined = raw ? JSON.parse(raw) : undefined;

initializeMap(savedSelection);
```

`SavedLocationSelection` is a discriminated union matching what you saved above:

```ts
type SavedLocationSelection = (
  | { kind: 'point'; geometry: Point }      // GeoJSON Point
  | { kind: 'polygon'; geometry: Polygon }  // GeoJSON Polygon
  | { kind: 'parcels'; parcelKeys: string[] }
) & {
  mapView?: { center: [number, number]; zoom: number }; // optional
};
```

The `initializeMap()` parameter is optional — omitting it (or passing `undefined`) behaves exactly as before, so this is a non-breaking addition if you're already calling `initializeMap()`.

### What happens on restore

- **`mapView`**: if provided, the map's *initial* camera (center/zoom) is set to it directly when the map is constructed — there's no default-view flash followed by a jump, it opens exactly where it left off. If omitted, the map falls back to its default Australia-wide view (as it always did).
- **`point`/`polygon`**: the saved geometry is added as a drawn feature (same as if the user had just drawn it) and the full lookup pipeline reruns immediately — marker/polygon appears, info panel populates, and a fresh `fullcam-location-selected` event fires with up-to-date data (including a fresh `mapView` matching wherever the map ended up).
- **`parcels`**: each saved parcel is re-fetched individually from its state's cadastre service by object id, so the restored selection is **fully editable** — the user can immediately click to add or remove parcels from it, exactly like a fresh selection. If a saved parcel key no longer resolves (e.g. the parcel was deleted/renumbered by the state authority since you saved it), it's skipped silently (logged to the console) rather than breaking the rest of the restore.
- Restoring the selection (as opposed to the view, which is instant) happens once, shortly after the map's initial style finishes loading — there's a brief delay (network round-trips to re-fetch weather/elevation/cadastre data) before the info panel and, for parcels, the highlighted shapes appear.

### Things to watch out for

- **Only pass `parcelKeys`, never `parcelIds`**, when restoring a parcel selection — `parcelIds` are for display and aren't guaranteed to round-trip correctly.
- **`initialSelection` (including `mapView`) is a one-shot restore on init**, not a live prop — calling `initializeMap()` again with different data won't update an already-running map, and there's no separate API to update just the camera later. If your app needs to load different saved data into an already-open map, tear down and re-`initializeMap()`.
- **A restored selection always re-fetches fresh data.** This map does no caching of weather/SA2/elevation results, by design (per the save/restore approach agreed above) — so treat every restore as a live lookup, not an instant replay of exactly what was previously shown.
- **`mapView.center` is `[lng, lat]`** (Mapbox's convention), not `[lat, lng]` — easy to transpose by mistake if you're used to other mapping libraries.

## Configuration

All configuration is managed through environment variables in the `.env` file:

- `VITE_MAPBOX_ACCESS_TOKEN` - Your Mapbox API token (required)
- `VITE_FULLCAM_SUBSCRIPTION_KEY` - FullCAM API key (required for FullCAM features)
- `VITE_API_PROXY_URL` - API proxy server URL (required for FullCAM features)

**Security Note**: Never commit your `.env` file to Git. Use `.env.example` as a template.

## Backend Proxy Server

The FullCAM API does not support CORS requests from browsers, so a backend proxy server is **required** for production deployment of features that use the FullCAM API (spatial-data-updater, etc.).

### Running Locally

Start the proxy server:
```bash
cd project
npm run proxy
```

This runs the proxy at `http://localhost:3001`.

### Deploying to Production

You need to deploy the proxy server (`src/api-proxy.ts`) separately. Options:

**Option 1: AWS Lambda + API Gateway** (Recommended)
1. Create a Lambda function with Node.js runtime
2. Deploy the proxy code to Lambda
3. Create an API Gateway to expose the Lambda
4. Set `VITE_API_PROXY_URL` in Amplify to your API Gateway URL

**Option 2: Separate Node.js Server**
1. Deploy `api-proxy.ts` to a Node.js hosting service (Heroku, Railway, etc.)
2. Set `VITE_API_PROXY_URL` in Amplify to your deployed server URL

Without a deployed proxy server, the spatial-data-updater and related FullCAM features will not work in production.

## License

Private
