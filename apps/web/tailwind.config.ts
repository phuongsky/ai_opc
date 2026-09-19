import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#0B0E11",
        panel: "#12161B",
        border: "#1F252C",
        accent: "#3DD68C", // trạng thái RUNNING / thành công
        warn: "#E8B339", // AWAITING_APPROVAL
        danger: "#E5484D", // BLOCKED / STOP
      },
    },
  },
  plugins: [],
};

export default config;
