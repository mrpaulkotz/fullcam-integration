export interface CarbonAnalysisRange {
  startYear: number;
  startStepInYear: number;
  endYear: number;
  endStepInYear: number;
}

interface StepCarbonChange {
  label: string;
  delta: number;
}

interface CumulativeCarbonPoint {
  label: string;
  total: number;
}

interface ChartResult {
  success: boolean;
  error?: string;
  data?: StepCarbonChange[];
}

function toStepPoint(year: number, stepInYear: number): number {
  return (year * 12) + (stepInYear - 1);
}

function extractStepCarbonChanges(simulationData: any, range: CarbonAnalysisRange): ChartResult {
  const csvData = typeof simulationData === 'string'
    ? simulationData
    : JSON.stringify(simulationData);

  const lines = csvData.split('\n').filter((line) => line.trim());
  if (lines.length < 2) {
    return { success: false, error: 'No simulation rows to chart' };
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  const yearIndex = headers.findIndex((h) => h.toLowerCase() === 'year');
  const stepIndex = headers.findIndex((h) => h.toLowerCase().includes('step in year'));
  const treesIndex = headers.findIndex((h) => h.includes('C mass of trees') && h.includes('tC/ha'));
  const debrisIndex = headers.findIndex((h) => h.includes('C mass of forest debris') && h.includes('tC/ha'));

  if (yearIndex === -1 || stepIndex === -1 || treesIndex === -1 || debrisIndex === -1) {
    return { success: false, error: 'Required carbon chart columns not found in simulation CSV' };
  }

  const points: Array<{ year: number; step: number; point: number; combinedCarbon: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const year = parseInt(values[yearIndex], 10);
    const step = parseInt(values[stepIndex], 10);
    const trees = parseFloat(values[treesIndex]);
    const debris = parseFloat(values[debrisIndex]);

    if (isNaN(year) || isNaN(step) || isNaN(trees) || isNaN(debris)) {
      continue;
    }

    points.push({
      year,
      step,
      point: toStepPoint(year, step),
      combinedCarbon: trees + debris
    });
  }

  points.sort((a, b) => a.point - b.point);

  if (points.length < 2) {
    return { success: false, error: 'Not enough data points to chart carbon change per step' };
  }

  const startPoint = Math.min(toStepPoint(range.startYear, range.startStepInYear), toStepPoint(range.endYear, range.endStepInYear));
  const endPoint = Math.max(toStepPoint(range.startYear, range.startStepInYear), toStepPoint(range.endYear, range.endStepInYear));

  const changes: StepCarbonChange[] = [];
  for (let i = 1; i < points.length; i++) {
    const current = points[i];
    const previous = points[i - 1];

    if (current.point < startPoint || current.point > endPoint) {
      continue;
    }

    changes.push({
      label: `${current.year}-S${current.step}`,
      delta: parseFloat((current.combinedCarbon - previous.combinedCarbon).toFixed(10))
    });
  }

  if (changes.length === 0) {
    return { success: false, error: 'No step changes found in selected analysis period' };
  }

  return { success: true, data: changes };
}

function getSharedTickIndices(seriesLength: number): Set<number> {
  const indices = new Set<number>();
  if (!seriesLength || seriesLength < 1) {
    return indices;
  }

  const xTickStep = Math.max(1, Math.ceil(seriesLength / 8));
  for (let index = 0; index < seriesLength; index++) {
    if (index % xTickStep === 0 || index === seriesLength - 1) {
      indices.add(index);
    }
  }

  return indices;
}

function setEmptyChart(container: HTMLElement | null, title: string, message: string): void {
  if (!container) {
    return;
  }

  container.innerHTML = `<div class="carbon-chart-title">${title}</div><div class="carbon-chart-empty">${message}</div>`;
}

function renderCarbonChangeChart(container: HTMLElement | null, changes: StepCarbonChange[], sharedTickIndices: Set<number>): void {
  if (!container) {
    return;
  }

  if (!changes || changes.length === 0) {
    setEmptyChart(container, 'Carbon Change Per Step in Year', 'No chart data available');
    return;
  }

  const width = 900;
  const height = 280;
  const margin = { top: 16, right: 10, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minDelta = Math.min(0, ...changes.map((c) => c.delta));
  const maxDelta = Math.max(0, ...changes.map((c) => c.delta));
  const range = Math.max(maxDelta - minDelta, 1e-9);

  const y = (value: number) => margin.top + ((maxDelta - value) / range) * plotHeight;
  const zeroY = y(0);
  const barWidth = Math.max(1, (plotWidth / changes.length) - 1);

  const bars = changes.map((change, index) => {
    const x = margin.left + index * (plotWidth / changes.length);
    const yPos = y(change.delta);
    const heightValue = Math.max(1, Math.abs(zeroY - yPos));
    const rectY = change.delta >= 0 ? yPos : zeroY;
    const color = change.delta >= 0 ? '#4CAF50' : '#f44336';

    return `<rect x="${x.toFixed(2)}" y="${rectY.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${heightValue.toFixed(2)}" fill="${color}"><title>${change.label}: ${change.delta.toFixed(10)} tC/ha</title></rect>`;
  }).join('');

  const xTicks = changes
    .map((change, index) => ({ change, index }))
    .filter(({ index }) => sharedTickIndices.has(index))
    .map(({ change, index }) => {
      const x = margin.left + index * (plotWidth / changes.length);
      return `<text x="${x.toFixed(2)}" y="${(height - 12).toFixed(2)}" font-size="10" fill="#666">${change.label}</text>`;
    })
    .join('');

  const yTicks = [maxDelta, 0, minDelta]
    .map((value) => `<text x="8" y="${(y(value) + 4).toFixed(2)}" font-size="10" fill="#666">${value.toFixed(4)}</text>`)
    .join('');

  container.innerHTML = `
    <div class="carbon-chart-title">Carbon Change Per Step in Year (tC/ha)</div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" role="img" aria-label="Carbon change per step in year">
      <line x1="${margin.left}" y1="${zeroY.toFixed(2)}" x2="${(width - margin.right)}" y2="${zeroY.toFixed(2)}" stroke="#999" stroke-width="1" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      <line x1="${margin.left}" y1="${(height - margin.bottom)}" x2="${(width - margin.right)}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      ${bars}
      ${xTicks}
      ${yTicks}
    </svg>
  `;
}

function buildCumulativeSequestrationSeries(changes: StepCarbonChange[]): CumulativeCarbonPoint[] {
  if (!changes || changes.length === 0) {
    return [];
  }

  let runningTotal = 0;
  return changes.map((change) => {
    runningTotal += change.delta;
    return {
      label: change.label,
      total: parseFloat(runningTotal.toFixed(10))
    };
  });
}

function renderCarbonTotalChart(container: HTMLElement | null, totals: CumulativeCarbonPoint[], sharedTickIndices: Set<number>): void {
  if (!container) {
    return;
  }

  if (!totals || totals.length === 0) {
    setEmptyChart(container, 'Total Carbon Sequestered by Step in Year', 'No chart data available');
    return;
  }

  const width = 900;
  const height = 280;
  const margin = { top: 16, right: 10, bottom: 44, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minValue = Math.min(0, ...totals.map((t) => t.total));
  const maxValue = Math.max(0, ...totals.map((t) => t.total));
  const valueRange = Math.max(maxValue - minValue, 1e-9);

  const y = (value: number) => margin.top + ((maxValue - value) / valueRange) * plotHeight;
  const x = (index: number) => margin.left + (index * plotWidth / Math.max(1, totals.length - 1));

  const polylinePoints = totals
    .map((total, index) => `${x(index).toFixed(2)},${y(total.total).toFixed(2)}`)
    .join(' ');

  const points = totals
    .map((total, index) => {
      const px = x(index);
      const py = y(total.total);
      return `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="2.5" fill="#1f78b4"><title>${total.label}: ${total.total.toFixed(10)} tC/ha</title></circle>`;
    })
    .join('');

  const xTicks = totals
    .map((total, index) => ({ total, index }))
    .filter(({ index }) => sharedTickIndices.has(index))
    .map(({ total, index }) => {
      const px = x(index);
      return `<text x="${px.toFixed(2)}" y="${(height - 12).toFixed(2)}" font-size="10" fill="#666">${total.label}</text>`;
    })
    .join('');

  const yTicks = [maxValue, (maxValue + minValue) / 2, minValue]
    .map((value) => `<text x="8" y="${(y(value) + 4).toFixed(2)}" font-size="10" fill="#666">${value.toFixed(4)}</text>`)
    .join('');

  container.innerHTML = `
    <div class="carbon-chart-title">Total Carbon Sequestered by Step in Year (tC/ha)</div>
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="280" role="img" aria-label="Total carbon sequestered by step in year">
      <line x1="${margin.left}" y1="${y(0).toFixed(2)}" x2="${(width - margin.right)}" y2="${y(0).toFixed(2)}" stroke="#999" stroke-width="1" />
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      <line x1="${margin.left}" y1="${(height - margin.bottom)}" x2="${(width - margin.right)}" y2="${(height - margin.bottom)}" stroke="#ccc" stroke-width="1" />
      <polyline points="${polylinePoints}" fill="none" stroke="#1f78b4" stroke-width="2" />
      ${points}
      ${xTicks}
      ${yTicks}
    </svg>
  `;
}

export function clearCarbonCharts(changeContainerId: string, totalContainerId: string): void {
  const changeContainer = document.getElementById(changeContainerId);
  const totalContainer = document.getElementById(totalContainerId);

  if (changeContainer) {
    changeContainer.innerHTML = '';
  }

  if (totalContainer) {
    totalContainer.innerHTML = '';
  }
}

export function renderStepSequestrationCharts(
  simulationData: any,
  range: CarbonAnalysisRange,
  changeContainerId: string,
  totalContainerId: string
): { success: boolean; error?: string } {
  const changeContainer = document.getElementById(changeContainerId);
  const totalContainer = document.getElementById(totalContainerId);

  const chartDataResult = extractStepCarbonChanges(simulationData, range);
  if (!chartDataResult.success || !chartDataResult.data) {
    const message = chartDataResult.error || 'No chart data available';
    setEmptyChart(changeContainer, 'Carbon Change Per Step in Year', message);
    setEmptyChart(totalContainer, 'Total Carbon Sequestered by Step in Year', message);
    return { success: false, error: message };
  }

  const sharedTickIndices = getSharedTickIndices(chartDataResult.data.length);
  renderCarbonChangeChart(changeContainer, chartDataResult.data, sharedTickIndices);
  const cumulativeTotals = buildCumulativeSequestrationSeries(chartDataResult.data);
  renderCarbonTotalChart(totalContainer, cumulativeTotals, sharedTickIndices);

  return { success: true };
}
