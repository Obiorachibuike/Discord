import { Invitation } from '@/components/app/invitation';
export default async function Page({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; return <Invitation token={token}/>; }
