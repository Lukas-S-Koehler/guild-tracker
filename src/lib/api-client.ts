/**
 * API client helper that automatically adds guild context headers
 * Use this instead of fetch() when making API requests from the frontend
 */

export interface ApiClientOptions extends RequestInit {
  guildId?: string;
}

export class ApiClient {
  private guildId: string | null = null;

  setGuildId(guildId: string | null) {
    this.guildId = guildId;
  }

  async fetch(url: string, options: ApiClientOptions = {}): Promise<Response> {
    const { guildId, headers, ...restOptions } = options;

    // Use provided guildId or fall back to instance guildId
    const contextGuildId = guildId || this.guildId;

    const requestHeaders = new Headers(headers);

    // Add guild context header if available
    if (contextGuildId) {
      requestHeaders.set('x-guild-id', contextGuildId);
    }

    return fetch(url, {
      ...restOptions,
      headers: requestHeaders,
    });
  }

  async get(url: string, options: ApiClientOptions = {}): Promise<Response> {
    return this.fetch(url, { ...options, method: 'GET' });
  }

  async post(url: string, data?: any, options: ApiClientOptions = {}): Promise<Response> {
    return this.fetch(url, {
      ...options,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put(url: string, data?: any, options: ApiClientOptions = {}): Promise<Response> {
    return this.fetch(url, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete(url: string, options: ApiClientOptions = {}): Promise<Response> {
    return this.fetch(url, { ...options, method: 'DELETE' });
  }
}

// Singleton instance
export const apiClient = new ApiClient();

/**
 * Hook to get an API client configured with the current guild context
 * Usage in components:
 *
 * const api = useApiClient();
 * const response = await api.get('/api/config');
 */
import { useAuth } from '@/contexts/AuthContext';

export function useApiClient() {
  const { currentGuild } = useAuth();

  // Create a client instance with the current guild
  const client = new ApiClient();
  if (currentGuild?.guild_id) {
    client.setGuildId(currentGuild.guild_id);
  }

  return client;
}
