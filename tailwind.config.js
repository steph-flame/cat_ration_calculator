/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Companion redesign: cards read as ~20px-radius rounded rectangles with a 1.5px
      // hairline border, site-wide — overriding these two defaults means every existing
      // `rounded-2xl`/`border` call site (cards, sections, banners) picks up the new look
      // with no per-file churn.
      borderRadius: { "2xl": "20px" },
      borderWidth: { DEFAULT: "1.5px" },
    },
  },
  plugins: [],
};
