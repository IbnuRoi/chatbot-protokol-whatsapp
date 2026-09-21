import { prisma } from '../src/database/prisma';

async function main() {
  const latestLogs = await prisma.activity_log.findMany({
    orderBy: { id: 'desc' },
    take: 5,
  });
  console.log('LATEST ACTIVITY LOGS:');
  console.log(JSON.stringify(latestLogs, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
