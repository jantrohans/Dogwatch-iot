import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://uvkqbzwonjqiigfvwobx.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV2a3FiendvbmpxaWlnZnZ3b2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTExNjUsImV4cCI6MjEwMDE4NzE2NX0.3z1wGD61RgEsSeLJRixAHP1taCh4PM96G5nL-QjSPlY'

export const supabase = createClient(supabaseUrl, supabaseKey)
