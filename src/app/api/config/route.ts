import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import slugify from 'slugify'; // 🚨 NEW: Import slugify

// Helper function to extract or set default settings
const DEFAULT_DONATION_REQUIREMENT = 5000;

// =================================================================
// 🚀 GET REQUEST: Fetch Existing Configuration
// =================================================================
export async function GET() {
  try {
    const supabase = createClient();

    // Select the necessary columns (id, guild_name, api_key, settings)
    const { data, error } = await supabase
      .from('guild_config')
      .select('id, guild_name, api_key, settings')
      .limit(1)
      .single();

    // PGRST116 means "No rows found"
    if (error && error.code !== 'PGRST116') {
      console.error('Supabase GET Error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      // If no config is found, return empty data structure for client to initialize
      return NextResponse.json({ 
        guild_name: '',
        api_key: '',
        donation_requirement: DEFAULT_DONATION_REQUIREMENT
      });
    }

    // Flatten the data for the client, extracting donation_requirement from 'settings'
    const clientData = {
        guild_name: data.guild_name || '',
        api_key: data.api_key || '',
        donation_requirement: data.settings?.donation_requirement || DEFAULT_DONATION_REQUIREMENT,
    };
    
    return NextResponse.json(clientData);

  } catch (error) {
    // Catches errors during client creation or other unexpected issues
    console.error('Unhandled API GET Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error fetching config.' },
      { status: 500 }
    );
  }
}

// =================================================================
// 💾 POST REQUEST: Save/Update Configuration
// =================================================================
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const body = await req.json();

    const { 
        guild_name, 
        api_key, 
        donation_requirement 
    } = body;

    // --- Validation ---
    if (!api_key) {
      return NextResponse.json({ error: 'API key is required' }, { status: 400 });
    }
    
    if (!guild_name) {
        return NextResponse.json({ error: 'Guild Name is required' }, { status: 400 });
    }
    // ------------------
    
    // 🚨 NEW: Generate the guild_id from the guild_name
    const guild_id = slugify(guild_name, { lower: true, strict: true });


    // 1. Check if config exists AND retrieve the existing settings to preserve them
    // We check for existence based on the generated guild_id. 
    // If the user changes the guild name, this will create a new config.
    const { data: existingRow, error: existingError } = await supabase
      .from('guild_config')
      .select('id, settings')
      .eq('guild_id', guild_id) // 🚨 Look up by the generated ID
      .limit(1)
      .single();
    
    // NOTE: We keep the lookup by single row for simplicity, but if you expect multiple
    // configurations (one per guild), the lookup should use the guild_id:
    /* const { data: existingRow, error: existingError } = await supabase
      .from('guild_config')
      .select('id, settings')
      .limit(1)
      .single();
    */
    
    if (existingError && existingError.code !== 'PGRST116') {
        console.error('Supabase Existence Check Error:', existingError.message);
        return NextResponse.json({ error: existingError.message }, { status: 500 });
    }
    
    // 2. Prepare the new/updated settings JSONB object
    const currentSettings = existingRow?.settings || {};
    
    const newSettings = {
        ...currentSettings, 
        donation_requirement: donation_requirement || DEFAULT_DONATION_REQUIREMENT,
    };

    const saveData = {
        guild_name,
        api_key,
        guild_id, // 🚨 INCLUDE the generated guild_id
        settings: newSettings, // Save the updated JSONB object
    };

    let result;

    if (existingRow) {
      // UPDATE
      result = await supabase
        .from('guild_config')
        .update({
            ...saveData,
            updated_at: new Date().toISOString(),
        })
        .eq('id', existingRow.id)
        .select()
        .single();
    } else {
      // INSERT
      result = await supabase
        .from('guild_config')
        .insert(saveData)
        .select()
        .single();
    }

    // 3. Handle INSERT/UPDATE Supabase error
    if (result.error) {
      console.error('Supabase Save Error:', result.error.message);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    // 4. Success Response
    const successData = {
        guild_name: result.data.guild_name,
        api_key: result.data.api_key,
        donation_requirement: result.data.settings?.donation_requirement || DEFAULT_DONATION_REQUIREMENT,
    }
    
    return NextResponse.json(successData, { status: 200 });

  } catch (error) {
    // 💥 CRITICAL CATCH BLOCK
    console.error('Unhandled API POST Error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'An unknown server error occurred.';

    return NextResponse.json(
      { error: `Internal Server Error: ${errorMessage}` }, 
      { status: 500 }
    );
  }
}