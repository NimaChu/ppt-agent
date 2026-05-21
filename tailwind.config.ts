import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        quiet: "#64748B",
        rail: "#E5E7EB",
        mist: "#F6F8FB",
        cobalt: "#2563EB",
        cyan: "#06B6D4",
        mint: "#10B981",
        amber: "#F59E0B",
        rose: "#E11D48",
      },
      boxShadow: {
        panel: "0 16px 50px rgba(15, 23, 42, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
