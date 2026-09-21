import { prisma } from '../src/database/prisma';

async function main() {
  const latestScheduled = await prisma.events.findMany({
    where: {
      deleted_at: null,
      event_time_start: { not: null },
    },
    orderBy: { event_time_start: 'desc' },
    take: 5,
  });
  console.log('LATEST SCHEDULED EVENTS:');
  console.log(JSON.stringify(latestScheduled, (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
