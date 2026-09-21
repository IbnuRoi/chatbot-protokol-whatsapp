import { prisma } from '../src/database/prisma';

async function main() {
  const users = await prisma.users.findMany({
    where: {
      OR: [
        { name: { contains: 'Ibnu', mode: 'insensitive' } },
        { name: { contains: 'Arya', mode: 'insensitive' } },
        { phone_number: { contains: '82124985997' } },
        { phone_number: { contains: '83194046850' } },
        { phone_number: { contains: '81200001111' } },
      ]
    }
  });
  console.log('SEARCH USERS RESULT:');
  console.log(JSON.stringify(users, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
