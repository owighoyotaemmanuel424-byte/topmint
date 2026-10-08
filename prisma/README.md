# TopMint database

TopMint uses PostgreSQL hosted on Neon through Prisma.

## Setup

1. Create a Neon PostgreSQL project.
2. Copy the pooled Neon connection string into DATABASE_URL.
3. Install dependencies.
4. Validate and generate Prisma Client:

    npm run db:validate
    npm run db:generate

5. Create the initial migration during development:

    npm run db:migrate -- --name init

6. Deploy migrations in production:

    npm run db:deploy

Do not commit .env or a real Neon connection string.
