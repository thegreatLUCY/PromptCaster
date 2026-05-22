/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        pixel: ["'Courier New'", "monospace"],
        terminal: ["'Courier New'", "monospace"]
      },
      colors: {
        void: "#08090b",
        iron: "#16181d",
        moss: "#79f2a6",
        amber: "#f0b34d",
        blood: "#a93f48",
        bone: "#d8d2bd"
      },
      boxShadow: {
        glow: "0 0 28px rgba(121, 242, 166, 0.18)",
        amber: "0 0 24px rgba(240, 179, 77, 0.2)"
      }
    }
  },
  plugins: []
};
