import express from 'express';
import { json } from 'body-parser';
import routes from '../routes/index'; // Adjust the relative path
import middlewares from './middlewares/index';
import '../styles/globals.css';

const app = express();

app.use(json());
app.use('/api', routes); // Use the imported routes

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}