import type { MaxTempData, RainfallData } from './types';

export const maxTempData: MaxTempData = {
  average_annual_max_temperatures: [
    {
      site: 9965,
      years: {
        '2020': 23.4,
        '2021': 23.0,
        '2022': 23.4,
        '2023': 23.8,
        '2024': 24.5
      }
    }
  ]
};

export const annualRainfallData: RainfallData = {
  average_annual_rainfall: [
    {
      site: 9965,
      years: {
        '2020': 621.8,
        '2021': 963.8,
        '2022': 772.2,
        '2023': 716.4,
        '2024': 932.2
      }
    }
  ]
};
