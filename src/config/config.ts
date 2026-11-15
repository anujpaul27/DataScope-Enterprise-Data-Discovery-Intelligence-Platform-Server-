import dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is empty! Check your .env file.");
}

interface Config {
  PORT: number;
  DATABASE_URL: string;
  CLIENT_URL: string | undefined;
}

const config: Config = {
  PORT: Number(process.env.PORT) || 5000,
  DATABASE_URL: process.env.DATABASE_URL,
  CLIENT_URL: process.env.CLIENT_URL,
};

export default config;
