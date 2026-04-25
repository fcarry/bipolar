import "server-only";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineController,
  LineElement,
  ScatterController,
  Tooltip,
  Title,
  Legend,
  Filler,
} from "chart.js";

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  ScatterController,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Title,
  Legend,
  Filler,
);

// Best-effort font registration so chart.js renders text with something other than the default.
try {
  // No required custom font — system default works for our use case.
  void GlobalFonts;
} catch {
  /* ignore */
}

const W = 900;
const H = 450;

function newCanvas() {
  const canvas = createCanvas(W, H);
  // White background
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  return canvas;
}

export interface SleepDailyPoint {
  dayKey: string; // YYYY-MM-DD
  sleepHours: number | null;
}

/** Bar chart — sleep hours per day, last 30d. Days without data render as 0 with a hatched gray. */
export async function renderSleepHoursPng(points: SleepDailyPoint[]): Promise<Buffer> {
  const canvas = newCanvas();
  const labels = points.map((p) => p.dayKey.slice(5)); // MM-DD
  const data = points.map((p) => p.sleepHours ?? 0);
  const colors = points.map((p) =>
    p.sleepHours == null ? "#e5e7eb" : p.sleepHours < 6 ? "#ef4444" : "#22c55e",
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = new Chart(canvas as any, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Horas dormidas",
          data,
          backgroundColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: {
          display: true,
          text: "Horas dormidas por día — últimos 30 días",
          font: { size: 18, weight: "bold" },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { font: { size: 10 }, maxRotation: 60, minRotation: 60 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          suggestedMax: 12,
          title: { display: true, text: "Horas" },
          grid: { color: "#f1f5f9" },
        },
      },
    },
  });
  chart.update();
  const buf = canvas.toBuffer("image/png");
  chart.destroy();
  return buf;
}

export interface WakeTimePoint {
  dayKey: string; // YYYY-MM-DD
  hourFraction: number; // 0..24, hour-of-day of wokeAt
}

/** Scatter — wake-time hour-of-day per day, last 30d. */
export async function renderWakeTimesPng(points: WakeTimePoint[]): Promise<Buffer> {
  const canvas = newCanvas();
  const labels = points.map((p) => p.dayKey.slice(5));
  const data = points.map((p, i) => ({ x: i, y: p.hourFraction }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = new Chart(canvas as any, {
    type: "scatter",
    data: {
      labels,
      datasets: [
        {
          label: "Hora del despertar",
          data,
          backgroundColor: "#3b82f6",
          borderColor: "#1d4ed8",
          pointRadius: 5,
          pointHoverRadius: 6,
        },
      ],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: {
          display: true,
          text: "Hora del despertar — últimos 30 días",
          font: { size: 18, weight: "bold" },
        },
        legend: { display: false },
      },
      scales: {
        x: {
          type: "linear",
          ticks: {
            font: { size: 10 },
            maxRotation: 60,
            minRotation: 60,
            stepSize: 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callback: ((value: any) => labels[Math.round(value)] ?? "") as any,
          },
          grid: { display: false },
          min: -0.5,
          max: labels.length - 0.5,
        },
        y: {
          min: 0,
          max: 24,
          ticks: {
            stepSize: 2,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            callback: ((value: any) => `${String(value).padStart(2, "0")}:00`) as any,
          },
          title: { display: true, text: "Hora del día (UY)" },
          grid: { color: "#f1f5f9" },
        },
      },
    },
  });
  chart.update();
  const buf = canvas.toBuffer("image/png");
  chart.destroy();
  return buf;
}
