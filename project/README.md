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
   - Add any other variables from `.env.example` as needed

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

## Configuration

All configuration is managed through environment variables in the `.env` file:

- `VITE_MAPBOX_ACCESS_TOKEN` - Your Mapbox API token (required)
- `VITE_FULLCAM_SUBSCRIPTION_KEY` - FullCAM API key (optional)
- `VITE_API_PROXY_URL` - API proxy server URL (default: http://localhost:3001)

**Security Note**: Never commit your `.env` file to Git. Use `.env.example` as a template.

## License

Private
