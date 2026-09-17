// @ts-nocheck
import { createClient } from '@/utils/supabase/server'

export default async function Page() {
  const supabase = createClient()

  const { data: todos } = await supabase.from('todos').select()

  return (
    <ul>
      {todos?.map((todo: any) => (
        <li key={todo.id}>{todo.name}</li>
      ))}
    </ul>
  )
}
