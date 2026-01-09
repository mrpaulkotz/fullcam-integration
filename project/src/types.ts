export interface Coordinates {
  lng: number;
  lat: number;
}

export interface WeatherSite {
  properties: SiteProperties;
  coordinates: [number, number];
  distance: string;
}

export interface SiteProperties {
  site?: number;
  id?: number;
  station_name?: string;
  name?: string;
  [key: string]: any;
}

export interface WeatherData {
  site: number;
  years: {
    [year: string]: number;
  };
}

export interface MaxTempData {
  average_annual_max_temperatures: WeatherData[];
}

export interface RainfallData {
  average_annual_rainfall: WeatherData[];
}
