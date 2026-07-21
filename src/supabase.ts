import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://uvkqbzwonjqiigfvwobx.supabase.co'
const supabaseKey = 'sb_publishable_CmO6hR_kyF3r9wMhtek7AQ_SDMrWzzP'

export const supabase = createClient(supabaseUrl, supabaseKey)
