import { prisma } from '../src/database/prisma';

async function main() {
  const users = await prisma.users.findMany({
    where: {
      deleted_at: null,
    },
    select: {
      id: true,
      name: true,
      phone_number: true,
      role: true,
      email: true,
    }
  });
  console.log('ACTIVE USERS IN DATABASE:');
  console.log(JSON.stringify(users, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
