// Tailwind config from OKX
// tailwind.config.js
module.exports = {
  content: ['./pages/**/*.{js,jsx}', './components/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        blue: {
          600: '#006AF5', // OKX blue
        },
        green: {
          600: '#10B981', // custom green
        }
      }
    },
  },
  plugins: [],
};
