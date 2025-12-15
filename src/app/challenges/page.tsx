'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Copy, Check } from 'lucide-react';
import { formatGold, copyToClipboard } from '@/lib/utils';

interface ChallengeItem {
  name: string;
  quantity: number;
  price: number;
  total: number;
  isExpensive: boolean;
}

export default function ChallengesPage() {
  const [rawInput, setRawInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [items, setItems] = useState<ChallengeItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

const handleCalculate = async () => {
  if (!rawInput.trim()) {
    setError('Please paste challenge data');
    return;
  }

  setProcessing(true);
  setError(null);
  setItems(null);

  try {
    const res = await fetch('/api/challenges/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw_input: rawInput }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to process');

    setItems(data.items);

    // 👉 Save challenge automatically
    const totalCost = data.items.reduce((sum: number, i: any) => sum + i.total, 0);
    await fetch('/api/challenges/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raw_input: rawInput,
        items: data.items,
        total_cost: totalCost,
      }),
    });
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to process');
  } finally {
    setProcessing(false);
  }
};



  const handleCopy = async () => {
    if (!items) return;

    const totalCost = items.reduce((sum, i) => sum + i.total, 0);
    const text = items
      .map(i => `${i.name} x${i.quantity.toLocaleString()} - ${formatGold(i.total)}${i.isExpensive ? ' ⚠️' : ''}`)
      .join('\n') + `\n\n**Total: ${formatGold(totalCost)}**`;

    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const totalCost = items?.reduce((sum, i) => sum + i.total, 0) || 0;
  const expensiveCount = items?.filter(i => i.isExpensive).length || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">📋 Challenge Calculator</h1>
        <p className="text-muted-foreground">
          Calculate total challenge cost and identify expensive items
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Challenge Input</CardTitle>
          <CardDescription>
            Paste challenge data (quantity on one line, item name on next)
          </CardDescription>
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
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Challenge Items</CardTitle>
                <CardDescription className="flex items-center gap-2 mt-1">
                  {items.length} items
                  {expensiveCount > 0 && (
                    <Badge variant="destructive">
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {expensiveCount} expensive
                    </Badge>
                  )}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                {copied ? 'Copied!' : 'Copy'}
              </Button>
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
                    <tr
                      key={i}
                      className={`border-b last:border-0 ${item.isExpensive ? 'text-red-500' : ''}`}
                    >
                      <td className="py-2">{item.name}</td>
                      <td className="py-2 text-right">{item.quantity.toLocaleString()}</td>
                      <td className="py-2 text-right">{formatGold(item.price)}</td>
                      <td className="py-2 text-right font-medium">
                        {formatGold(item.total)}
                        {item.isExpensive && ' ⚠️'}
                      </td>
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
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <p className="text-sm text-yellow-500">
                  ⚠️ <strong>{expensiveCount} items</strong> cost over 15,000g each. Consider refreshing these!
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
