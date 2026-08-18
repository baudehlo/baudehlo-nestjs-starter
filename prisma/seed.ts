import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function main() {
  // Add seed data here as needed for testing
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
