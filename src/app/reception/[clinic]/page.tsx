import Reception from '@/components/Reception';
export default async function Page({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return <Reception clinic={clinic} />;
}
