import DoctorPad from '@/components/DoctorPad';
export default async function Page({ params }: { params: Promise<{ clinic: string }> }) {
  const { clinic } = await params;
  return <DoctorPad clinic={clinic} />;
}
