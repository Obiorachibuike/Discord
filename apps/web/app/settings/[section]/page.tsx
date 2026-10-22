import { SettingsPage } from '@/components/app/settings';
export default async function Page({ params }: { params: Promise<{ section: string }> }) { const { section } = await params; return <SettingsPage section={section}/>; }
