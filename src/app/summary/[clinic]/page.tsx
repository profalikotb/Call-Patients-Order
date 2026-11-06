import Summary from '@/components/Summary';
export default async function Page({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return <Summary clinic={clinic} />;
}
