import { prisma } from '../src/database/prisma';

async function main() {
  const latestLetters = await prisma.letters.findMany({
    where: { deleted_at: null },
    orderBy: { id: 'desc' },
    take: 5,
  });
  console.log('LATEST LETTERS:');
  console.log(JSON.stringify(latestLetters, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
