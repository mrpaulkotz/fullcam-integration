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

```bash
npm install
```

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

## Configuration

The Mapbox access token is configured in `src/map.ts`. Update it with your own token if needed.

## License

Private
