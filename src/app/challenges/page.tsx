'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle, Copy, Check, Settings, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { formatGold, copyToClipboard } from '@/lib/utils';
import { useApiClient } from '@/lib/api-client';

interface ChallengeItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  isExpensive: boolean;
}

export default function ChallengeInputPage() {
  const [rawInput, setRawInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [items, setItems] = useState<ChallengeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [csvData, setCsvData] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; skipped_items: string[] } | null>(null);
  const api = useApiClient();

  const handleCalculate = async () => {
    if (!rawInput.trim()) {
      setError('Please paste challenge data');
      return;
    }

    setProcessing(true);
    setError(null);
    setItems(null);

    try {
      const res = await api.post('/api/challenges/parse', { raw_input: rawInput });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to process');

      setItems(data.items);

      // Save challenge automatically (server attaches guild_id)
      const totalCost = data.items.reduce((sum: number, i: any) => sum + i.total, 0);
      const saveRes = await api.post('/api/challenges/save', {
        raw_input: rawInput,
        items: data.items,
        total_cost: totalCost,
      });

      if (!saveRes.ok) {
        const txt = await saveRes.text();
        console.warn('Save failed:', txt);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process');
    } finally {
      setProcessing(false);
    }
  };

  const handleCopy = async () => {
    if (!items) return;

    const totalCost = items.reduce((sum, i) => sum + i.total, 0);
    const text =
      items
        .map(
          (i) =>
            `${i.name} x${i.quantity.toLocaleString()} - ${formatGold(i.total)}${
              i.isExpensive ? ' ⚠️' : ''
            }`
        )
        .join('\n') + `\n\n**Total: ${formatGold(totalCost)}**`;

    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleImportCsv = async () => {
    if (!csvData.trim()) {
      setError('Please paste CSV data');
      return;
    }

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const res = await api.post('/api/challenge-items/import', { csv_data: csvData });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to import');

      setImportResult(data);
      setCsvData(''); // Clear input on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setImporting(false);
    }
  };

  const totalCost = items?.reduce((sum, i) => sum + i.total, 0) || 0;
  const expensiveCount = items?.filter((i) => i.isExpensive).length || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📋 Challenge Calculator</h1>
          <p className="text-muted-foreground">Paste challenge items to calculate cost</p>
        </div>
        <div>
          <Button asChild variant="outline" size="sm">
            <Link href="/challenges/list">
              View Saved Challenges
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="ml-2">
            <Link href="/setup">
              <Settings className="h-4 w-4 mr-2" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      {/* CSV Import Section */}
      <Card className="border-blue-500/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-blue-600 dark:text-blue-400">Import Challenge Item Quantities</CardTitle>
              <CardDescription>Import initial quantities for challenge items from CSV</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowCsvImport(!showCsvImport)}
            >
              {showCsvImport ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>

        {showCsvImport && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>CSV Data (item_name,initial_quantity)</Label>
              <Textarea
                placeholder={`Paste CSV data here...

Format:
Abyssal Scroll,5
Aetherial Feather Quill,35
Air Elemental Essence,20

Leave quantity empty or use — to skip items`}
                value={csvData}
                onChange={(e) => setCsvData(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleImportCsv} disabled={importing || !csvData.trim()}>
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Import CSV
                  </>
                )}
              </Button>
              {csvData && (
                <Button variant="outline" onClick={() => { setCsvData(''); setImportResult(null); }}>
                  Clear
                </Button>
              )}
            </div>

            {importResult && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700">
                  ✅ Successfully imported <strong>{importResult.imported}</strong> items
                  {importResult.skipped > 0 && (
                    <span className="ml-2">
                      (skipped {importResult.skipped} items with empty quantities)
                    </span>
                  )}
                </p>
                {importResult.skipped_items && importResult.skipped_items.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs cursor-pointer text-green-600">
                      Show skipped items
                    </summary>
                    <ul className="mt-1 text-xs text-green-600 ml-4">
                      {importResult.skipped_items.map((item, i) => (
                        <li key={i}>• {item}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Challenge Input</CardTitle>
          <CardDescription>Quantity on one line, item name on the next</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Challenge Data</Label>
            <Textarea
              placeholder={`Paste challenge items here...

Example format:
35
Siren's Soulstone21h
1,340
Maple Log21h
2,400
Copper Ore21h`}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>

          <Button onClick={handleCalculate} disabled={processing || !rawInput.trim()}>
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Fetching Prices...
              </>
            ) : (
              'Calculate Challenge Cost'
            )}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 text-destructive rounded-lg">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {items && items.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between w-full">
              <div>
                <CardTitle>Challenge Items</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  {items.length} items
                  {expensiveCount > 0 && (
                    <span className="ml-2 inline-flex items-center rounded bg-red-100 text-red-600 px-2 py-0.5 text-xs">
                      ⚠️ {expensiveCount} expensive
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="pb-2">Item</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Unit Price</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => (
                    <tr key={i} className={`border-b last:border-0 ${item.isExpensive ? 'text-red-600' : ''}`}>
                      <td className="py-2">{item.name}</td>
                      <td className="py-2 text-right">{item.quantity.toLocaleString()}</td>
                      <td className="py-2 text-right">{formatGold(item.price)}</td>
                      <td className="py-2 text-right font-medium">{formatGold(item.total)}{item.isExpensive && ' ⚠️'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold border-t-2">
                    <td colSpan={3} className="pt-3">Total Challenge Cost</td>
                    <td className="pt-3 text-right text-lg">{formatGold(totalCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {expensiveCount > 0 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-700">
                  ⚠️ <strong>{expensiveCount} items</strong> cost over 15,000g each.
                </p>
              </div>
            )}

            <Button variant="outline" className="w-full mt-4" onClick={() => setItems(null)}>
              Clear Results
            </Button>
          </CardContent>
        </Card>
      )}

      {items && items.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No valid items found. Make sure the format is correct (quantity on one line, item name on next).
          </CardContent>
        </Card>
      )}
    </div>
  );
}
