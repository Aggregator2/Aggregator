# Prisma ORM Project

This project demonstrates how to use Prisma ORM with an SQLite database for local development and PostgreSQL for production. It includes a simple order management system with functionalities to add, fetch, and update orders.

## Project Structure

```
prisma-orm-project
├── prisma
│   ├── schema.prisma         # Prisma schema definition
├── src
│   ├── db.ts                 # Database connection and Prisma client initialization
│   ├── app.ts                # Entry point of the application
│   ├── controllers
│   │   ├── orderController.ts # Controller for order operations
│   └── routes
│       ├── orderRoutes.ts     # Routes for order-related operations
├── .env                       # Environment variables for local development
├── .env.production            # Environment variables for production
├── package.json               # npm configuration file
├── tsconfig.json             # TypeScript configuration file
└── README.md                  # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd prisma-orm-project
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Set up the database:**
   - For local development, create a `.env` file in the root directory with the following content:
     ```
     DATABASE_URL="file:./dev.db"
     ```
   - For production, create a `.env.production` file with your PostgreSQL connection string:
     ```
     DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
     ```

4. **Run Prisma migrations:**
   ```bash
   npx prisma migrate dev --name init
   ```

5. **Start the application:**
   ```bash
   npm run start
   ```

## Usage Examples

- **Add a new order:**
  Send a POST request to `/orders` with the order details in the request body.

- **Fetch all orders:**
  Send a GET request to `/orders`.

- **Fetch an order by ID:**
  Send a GET request to `/orders/:id`.

- **Update order status:**
  Send a PATCH request to `/orders/:id` with the new status in the request body.

## License

This project is licensed under the MIT License.