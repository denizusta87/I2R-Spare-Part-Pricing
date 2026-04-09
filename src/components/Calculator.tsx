import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  ArrowLeft,
  Settings, 
  Calculator as CalcIcon,
  TrendingUp,
  Info,
  RefreshCw,
  Search,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { get, set, del } from 'idb-keyval';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type SettingsState = {
  kur: number;
  premium: number;
  sgav: number;
  planGm2: number;
};

type ExcelConfig = {
  searchCol: string;
  priceCol: string;
  displayCols?: string[]; // Added for source 4
};

type ExcelSource = {
  rawData: any[][];
  headers: string[];
  config: ExcelConfig;
  fileName: string;
};

const SOURCE_NAMES = ['ManP', 'Bitron', 'CWS', 'Ürün Detayları'];

const DEFAULT_SETTINGS: SettingsState = {
  kur: 35.50,
  premium: 1.15,
  sgav: 12,
  planGm2: 15
};

export default function Calculator() {
  const [view, setView] = useState<'calculator' | 'settings'>('calculator');
  const [materialNo, setMaterialNo] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [isPriceVisible, setIsPriceVisible] = useState(true);
  const [gmsInput, setGmsInput] = useState('');
  const [isManualGms, setIsManualGms] = useState(false);
  const [lastLookupStatus, setLastLookupStatus] = useState<'none' | 'found' | 'not-found'>('none');
  const [detailsLookupStatus, setDetailsLookupStatus] = useState<'none' | 'found' | 'not-found'>('none');
  const [foundSourceIndex, setFoundSourceIndex] = useState<number | null>(null);
  const [foundDetails, setFoundDetails] = useState<Record<string, any> | null>(null);
  const [isDbLoading, setIsDbLoading] = useState(true);

  const [sources, setSources] = useState<ExcelSource[]>([
    { rawData: [], headers: [], config: { searchCol: '', priceCol: '', displayCols: [] }, fileName: '' },
    { rawData: [], headers: [], config: { searchCol: '', priceCol: '', displayCols: [] }, fileName: '' },
    { rawData: [], headers: [], config: { searchCol: '', priceCol: '', displayCols: [] }, fileName: '' },
    { rawData: [], headers: [], config: { searchCol: '', priceCol: '', displayCols: Array(7).fill('') }, fileName: '' },
  ]);

  const [settings, setSettings] = useState<SettingsState>(() => {
    const saved = localStorage.getItem('nova_calc_settings');
    return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
  });

  // Persist settings
  useEffect(() => {
    localStorage.setItem('nova_calc_settings', JSON.stringify(settings));
  }, [settings]);

  // Persist Excel Configs
  useEffect(() => {
    const configs = sources.map(s => s.config);
    localStorage.setItem('nova_excel_configs', JSON.stringify(configs));
  }, [sources]);

  // Load Excel Data from IndexedDB on mount
  useEffect(() => {
    const loadSavedData = async () => {
      try {
        const newSources = [...sources];
        const savedConfigs = localStorage.getItem('nova_excel_configs');
        const configs = savedConfigs ? JSON.parse(savedConfigs) : null;

        for (let i = 0; i < 4; i++) {
          const rawData = await get(`nova_raw_excel_data_${i}`);
          const headers = localStorage.getItem(`nova_excel_headers_${i}`);
          const fileName = localStorage.getItem(`nova_file_name_${i}`);
          
          if (rawData) newSources[i].rawData = rawData;
          if (headers) newSources[i].headers = JSON.parse(headers);
          if (fileName) newSources[i].fileName = fileName;
          if (configs && configs[i]) newSources[i].config = configs[i];
        }
        setSources(newSources);
      } catch (err) {
        console.error('Failed to load Excel data from storage:', err);
      } finally {
        setIsDbLoading(false);
      }
    };
    loadSavedData();
  }, []);

  // Memoized databases to ensure they stay in sync with raw data and config
  const databases = useMemo(() => {
    return sources.map((source, idx) => {
      const isDetailSource = idx === 3;
      
      if (source.rawData.length === 0 || !source.config.searchCol || (!isDetailSource && !source.config.priceCol)) {
        return new Map<string, any>();
      }

      const headers = source.rawData[0];
      const sIdx = headers.indexOf(source.config.searchCol);
      const pIdx = isDetailSource ? -1 : headers.indexOf(source.config.priceCol);

      if (sIdx === -1 || (!isDetailSource && pIdx === -1)) return new Map<string, any>();

      const newDatabase = new Map<string, any>();
      source.rawData.slice(1).forEach((row) => {
        const rawKey = row[sIdx];
        if (rawKey === undefined) return;

        let key = String(rawKey).trim();
        if (typeof rawKey === 'number') {
          key = rawKey.toLocaleString('fullwide', { useGrouping: false });
        }
        
        if (isDetailSource) {
          newDatabase.set(key, row);
        } else {
          const rawVal = row[pIdx];
          if (rawVal === undefined) return;
          
          let val: number;
          if (typeof rawVal === 'number') {
            val = rawVal;
          } else {
            const valStr = String(rawVal).replace(/[^0-9,.-]/g, '').replace(',', '.');
            val = parseFloat(valStr);
          }
          
          if (key && !isNaN(val)) {
            newDatabase.set(key, val);
          }
        }
      });

      return newDatabase;
    });
  }, [sources]);

  const numericValue = parseFloat(inputValue.replace(',', '.'));

  // Standard calculation data (based on Plan GM2)
  const standardData = useMemo(() => {
    if (isNaN(numericValue) || numericValue === 0) {
      return { listeFiyati: 0, gms: 0, tns: 0, netSatinalma: 0 };
    }
    const netSatinalma = numericValue * settings.kur;
    const listeFiyatiHam = (netSatinalma / (1 - settings.planGm2 / 100)) / 0.7;
    const listeFiyatiMround = Math.round(listeFiyatiHam / 5) * 5;
    const tns = listeFiyatiMround * settings.premium;
    const gms = tns !== 0 ? ((tns - netSatinalma) / tns) - (settings.sgav / 100) : 0;
    
    return {
      listeFiyati: listeFiyatiMround,
      gms: gms * 100,
      tns,
      netSatinalma
    };
  }, [numericValue, settings]);

  // Final calculation data (either standard or manual GMS)
  const calculatedData = useMemo(() => {
    if (isNaN(numericValue) || numericValue === 0) {
      return { listeFiyati: 0, gms: 0, tns: 0, netSatinalma: 0 };
    }

    if (isManualGms) {
      const netSatinalma = numericValue * settings.kur;
      const targetGms = parseFloat(gmsInput.replace(',', '.'));
      
      if (isNaN(targetGms)) return standardData;

      // Reverse formula:
      // GMS = ((TNS - Net) / TNS) - SG&AV
      // GMS + SG&AV = 1 - Net/TNS
      // Net/TNS = 1 - (GMS + SG&AV)
      // TNS = Net / (1 - (GMS + SG&AV))
      const marginFactor = 1 - (targetGms / 100 + settings.sgav / 100);
      
      if (marginFactor <= 0) return standardData; // Prevent division by zero or negative margin

      const tns = netSatinalma / marginFactor;
      const listeFiyati = tns / settings.premium;
      const listeFiyatiMround = Math.round(listeFiyati / 5) * 5;

      // Recalculate actual GMS from rounded price
      const actualTns = listeFiyatiMround * settings.premium;
      const actualGms = actualTns !== 0 ? ((actualTns - netSatinalma) / actualTns) - (settings.sgav / 100) : 0;

      return {
        listeFiyati: listeFiyatiMround,
        gms: actualGms * 100,
        tns: actualTns,
        netSatinalma
      };
    }

    return standardData;
  }, [numericValue, settings, gmsInput, isManualGms, standardData]);

  // Sync GMS input when standard data changes (and not in manual mode)
  useEffect(() => {
    if (!isManualGms) {
      setGmsInput(standardData.gms.toFixed(2));
    }
  }, [standardData, isManualGms]);

  const resultStr = calculatedData.listeFiyati.toLocaleString('tr-TR', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });

  const gmsStr = calculatedData.gms.toFixed(2);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^[0-9,.]*$/.test(value)) {
      setInputValue(value);
      setIsManualGms(false); // Reset to standard when price changes
    }
  };

  const handleGmsInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^[0-9,.-]*$/.test(value)) {
      setGmsInput(value);
      setIsManualGms(true);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const files = e.target.files;
    if (!files) return;

    const file = files[0];
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target?.result as string;
      const wb = XLSX.read(bstr, { type: 'binary', cellDates: true, cellNF: false, cellText: false });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][];

      if (data.length > 0) {
        const headers = data[0].map(h => String(h || '').trim()).filter(h => h !== '');
        
        const newSources = [...sources];
        newSources[index] = {
          ...newSources[index],
          rawData: data,
          headers: headers,
          fileName: file.name
        };

        // Auto-select columns
        const searchMatch = headers.find(h => h.toLowerCase().includes('malzeme') || h.toLowerCase().includes('no') || h.toLowerCase().includes('id'));
        const priceMatch = headers.find(h => h.toLowerCase().includes('fiyat') || h.toLowerCase().includes('price') || h.toLowerCase().includes('brüt'));
        
        if (searchMatch || priceMatch) {
          newSources[index].config = {
            searchCol: searchMatch || headers[0],
            priceCol: priceMatch || (headers[1] || headers[0])
          };
        }

        setSources(newSources);
        
        // Save to storage
        await set(`nova_raw_excel_data_${index}`, data);
        localStorage.setItem(`nova_excel_headers_${index}`, JSON.stringify(headers));
        localStorage.setItem(`nova_file_name_${index}`, file.name);
      }
    };
    reader.readAsBinaryString(file);
  };

  const clearDatabase = async (index: number) => {
    const newSources = [...sources];
    newSources[index] = {
      rawData: [],
      headers: [],
      config: { searchCol: '', priceCol: '', displayCols: index === 3 ? Array(7).fill('') : [] },
      fileName: ''
    };
    setSources(newSources);
    
    await del(`nova_raw_excel_data_${index}`);
    localStorage.removeItem(`nova_excel_headers_${index}`);
    localStorage.removeItem(`nova_file_name_${index}`);
  };

  const updateSourceConfig = (index: number, field: keyof ExcelConfig, value: string, displayIdx?: number) => {
    const newSources = [...sources];
    if (field === 'displayCols' && displayIdx !== undefined) {
      const newDisplayCols = [...(newSources[index].config.displayCols || [])];
      newDisplayCols[displayIdx] = value;
      newSources[index].config.displayCols = newDisplayCols;
    } else {
      newSources[index].config = {
        ...newSources[index].config,
        [field]: value
      };
    }
    setSources(newSources);
  };

  // Lookup logic when materialNo changes
  useEffect(() => {
    const trimmedNo = materialNo.trim();
    if (!trimmedNo) {
      setLastLookupStatus('none');
      setDetailsLookupStatus('none');
      setFoundSourceIndex(null);
      setFoundDetails(null);
      return;
    }

    let foundPrice: number | undefined;
    let sourceIdx: number | null = null;
    
    // Check price sources (1, 2, 3)
    for (let i = 0; i < 3; i++) {
      if (databases[i].has(trimmedNo)) {
        foundPrice = databases[i].get(trimmedNo);
        sourceIdx = i;
        break;
      }
    }

    // Check detail source (4)
    if (databases[3].has(trimmedNo)) {
      const row = databases[3].get(trimmedNo);
      const headers = sources[3].rawData[0];
      const details: { label: string; value: any }[] = [];
      
      sources[3].config.displayCols?.forEach(colName => {
        if (colName) {
          const colIdx = headers.indexOf(colName);
          if (colIdx !== -1) {
            details.push({ label: colName, value: row[colIdx] });
          }
        }
      });
      setFoundDetails(details);
      setDetailsLookupStatus('found');
    } else {
      setFoundDetails(null);
      setDetailsLookupStatus(sources[3].rawData.length > 0 ? 'not-found' : 'none');
    }

    if (foundPrice !== undefined) {
      setInputValue(foundPrice.toFixed(2).replace('.', ','));
      setIsManualGms(false);
      setLastLookupStatus('found');
      setFoundSourceIndex(sourceIdx);
    } else if (sources.slice(0, 3).some(s => s.rawData.length > 0)) {
      setLastLookupStatus('not-found');
      setFoundSourceIndex(null);
    }
  }, [materialNo, sources, databases]);

  const updateSetting = (key: keyof SettingsState, value: string) => {
    const num = parseFloat(value.replace(',', '.'));
    if (!isNaN(num)) {
      setSettings(prev => ({ ...prev, [key]: num }));
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen p-4 bg-background">
      <Card className="w-full max-w-[400px] bg-card border-border hardware-glow overflow-hidden relative">
        {view === 'calculator' ? (
          <>
            {/* Hardware Status Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">I2R Spare Part Pricing v1.8</span>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => setView('settings')}
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  <Settings size={14} />
                </button>
              </div>
            </div>

            <CardContent className="p-8 space-y-8">
              {/* Material No Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="material-input" className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Malzeme No
                    </Label>
                    {lastLookupStatus === 'found' && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-500/10 border border-green-500/20"
                      >
                        <CheckCircle2 size={10} className="text-green-500" />
                        <span className="text-[8px] font-mono text-green-600 font-bold uppercase">
                          {foundSourceIndex !== null ? `${SOURCE_NAMES[foundSourceIndex]}'den Bulundu` : 'Bulundu'}
                        </span>
                      </motion.div>
                    )}
                    {lastLookupStatus === 'not-found' && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20"
                      >
                        <AlertCircle size={10} className="text-amber-500" />
                        <span className="text-[8px] font-mono text-amber-600 font-bold uppercase">Kayıt Yok</span>
                      </motion.div>
                    )}
                  </div>
                  <Search size={12} className="text-muted-foreground opacity-50" />
                </div>
                <div className="relative group">
                  <Input
                    id="material-input"
                    type="text"
                    value={materialNo}
                    onChange={(e) => setMaterialNo(e.target.value)}
                    placeholder="Örn: 100234"
                    className="h-12 font-mono bg-secondary/50 border-border focus:border-accent/50 focus:ring-accent/20 transition-all text-right pr-4"
                  />
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 font-mono text-[10px]">
                    MAT#
                  </div>
                </div>
              </div>

              {/* Input Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="price-input" className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      Brüt Fiyat (EUR)
                    </Label>
                    <button 
                      onClick={() => setIsPriceVisible(!isPriceVisible)}
                      className="text-muted-foreground hover:text-accent transition-colors"
                      title={isPriceVisible ? "Gizle" : "Göster"}
                    >
                      {isPriceVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  </div>
                  <CalcIcon size={12} className="text-muted-foreground opacity-50" />
                </div>
                {isPriceVisible && (
                  <motion.div 
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="relative group overflow-hidden"
                  >
                    <Input
                      id="price-input"
                      type="text"
                      value={inputValue}
                      onChange={handleInputChange}
                      placeholder="0"
                      className="h-16 text-2xl font-mono bg-secondary/50 border-border focus:border-accent/50 focus:ring-accent/20 transition-all text-right pr-4"
                      autoFocus
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 font-mono text-xs">
                      EUR
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Result Area */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] font-mono uppercase tracking-widest text-accent font-bold">
                      Liste Fiyatı (MROUND 5)
                    </Label>
                    <TrendingUp size={12} className="text-accent opacity-50" />
                  </div>
                  <div className="bg-secondary/80 rounded-lg p-6 border border-accent/30 relative overflow-hidden group min-h-[100px] flex flex-col justify-center">
                    <div className="absolute top-2 right-4 text-[8px] font-mono text-muted-foreground uppercase tracking-tighter opacity-50">
                      Final Output
                    </div>
                    <div className="text-right">
                      <motion.div 
                        key={resultStr}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="text-4xl font-mono font-bold tracking-tighter text-green-600 display-glow truncate"
                      >
                        {resultStr} <span className="text-lg opacity-70 ml-1">TL</span>
                      </motion.div>
                    </div>
                  </div>
                </div>

                {/* GMS Input Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        calculatedData.gms >= 15 ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.3)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                      )} />
                      <Label htmlFor="gms-input" className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        GMS (Brüt Kar Marjı)
                      </Label>
                    </div>
                    {isManualGms && (
                      <button 
                        onClick={() => setIsManualGms(false)}
                        className="text-[9px] font-mono uppercase text-accent hover:underline flex items-center gap-1"
                      >
                        <RefreshCw size={10} />
                        Sıfırla
                      </button>
                    )}
                  </div>
                  <div className="relative group">
                    <Input
                      id="gms-input"
                      type="text"
                      value={gmsInput}
                      onChange={handleGmsInputChange}
                      className={cn(
                        "h-12 font-mono bg-secondary/40 border-border focus:border-accent/50 focus:ring-accent/20 transition-all text-right pr-4 font-bold",
                        calculatedData.gms >= 15 ? "text-green-600" : "text-red-600"
                      )}
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60 font-mono text-xs">
                      %
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-1 pt-4">
                <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/70 uppercase tracking-[0.2em]">
                  <Info size={10} />
                  Dinamik Parametreler Aktif
                </div>
                <div className="text-[8px] font-mono text-muted-foreground/50 uppercase tracking-widest">
                  Deniz Usta (HC/SME-I2R)
                </div>
              </div>

              {/* Product Details Section */}
              {detailsLookupStatus !== 'none' && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "p-4 rounded-xl border space-y-3 transition-colors",
                    detailsLookupStatus === 'found' ? "bg-secondary/30 border-border/50" : "bg-amber-500/5 border-amber-500/20"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-accent">
                      <Info size={12} />
                      <span className="text-[10px] font-mono uppercase font-bold tracking-widest">Ürün Detayları</span>
                    </div>
                    {detailsLookupStatus === 'not-found' && (
                      <span className="text-[8px] font-mono text-amber-600 font-bold uppercase">Kayıt Bulunamadı</span>
                    )}
                  </div>
                  
                  {detailsLookupStatus === 'found' && foundDetails && foundDetails.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2">
                      {foundDetails.map((detail, dIdx) => (
                        <div key={`${detail.label}-${dIdx}`} className="flex justify-between items-start gap-4 border-b border-border/20 pb-1 last:border-0">
                          <span className="text-[9px] font-mono text-muted-foreground uppercase shrink-0">{detail.label}:</span>
                          <span className="text-[9px] font-mono text-primary font-bold text-right">{String(detail.value || '-')}</span>
                        </div>
                      ))}
                    </div>
                  ) : detailsLookupStatus === 'found' ? (
                    <p className="text-[9px] font-mono text-muted-foreground italic text-center py-2">
                      Görüntülenecek sütun seçilmedi.
                    </p>
                  ) : null}
                </motion.div>
              )}
            </CardContent>
          </>
        ) : (
          <>
            {/* Settings Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-border">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setView('calculator')}
                  className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  <ArrowLeft size={14} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">Geri</span>
                </button>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-accent font-bold">Genel Ayarlar</span>
            </div>

            <ScrollArea className="h-[600px]">
              <div className="p-6 space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Kur (EUR/TRY)</Label>
                    <Input 
                      type="number" 
                      step="0.01"
                      value={settings.kur} 
                      onChange={(e) => updateSetting('kur', e.target.value)}
                      className="bg-secondary/50 border-border font-mono"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Premium Katsayı</Label>
                    <Input 
                      type="number" 
                      step="0.01"
                      value={settings.premium} 
                      onChange={(e) => updateSetting('premium', e.target.value)}
                      className="bg-secondary/50 border-border font-mono"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">% SG&AV</Label>
                      <Input 
                        type="number" 
                        value={settings.sgav} 
                        onChange={(e) => updateSetting('sgav', e.target.value)}
                        className="bg-secondary/50 border-border font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">Plan GM2</Label>
                      <Input 
                        type="number" 
                        value={settings.planGm2} 
                        onChange={(e) => updateSetting('planGm2', e.target.value)}
                        className="bg-secondary/50 border-border font-mono"
                      />
                    </div>
                  </div>

                  <Separator className="bg-border/50" />
                  
                  <div className="p-4 rounded-lg bg-secondary/20 border border-border/30 space-y-3">
                    <div className="flex items-center gap-2 text-accent">
                      <Info size={12} />
                      <span className="text-[9px] font-mono uppercase font-bold">Formül Bilgisi</span>
                    </div>
                    <div className="space-y-1 text-[9px] font-mono text-muted-foreground/80">
                      <p>1. Net Satınalma = Brüt * Kur</p>
                      <p>2. Liste (Ham) = (Net / (1-GM2)) / 0.7</p>
                      <p>3. Liste (MROUND) = Ham (En yakın 5)</p>
                      <p>4. TNS = Liste * Premium</p>
                      <p>5. GMS = ((TNS-Net)/TNS) - SG&AV</p>
                    </div>
                  </div>

                  <Button 
                    variant="outline" 
                    className="w-full text-[10px] font-mono uppercase tracking-widest h-10"
                    onClick={() => setSettings(DEFAULT_SETTINGS)}
                  >
                    <RefreshCw size={12} className="mr-2" />
                    Varsayılana Dön
                  </Button>

                  <Separator className="bg-border/50" />

                  {/* Excel Data Management */}
                  <div className="space-y-4 p-4 rounded-xl bg-accent/5 border border-accent/20 shadow-inner">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet size={16} className="text-accent" />
                      <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-accent font-bold">Veri Kaynakları (Öncelik Sıralı)</h3>
                    </div>

                    <div className="space-y-6">
                      {sources.map((source, idx) => (
                        <div key={idx} className="space-y-4 p-3 rounded bg-white/50 border border-border/30 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-mono uppercase font-bold text-accent/70">{SOURCE_NAMES[idx]}</span>
                            {source.fileName && (
                              <button 
                                onClick={() => clearDatabase(idx)}
                                className="text-[8px] font-mono uppercase text-red-500 hover:underline"
                              >
                                Sil
                              </button>
                            )}
                          </div>

                          {source.headers.length > 0 && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                  <Label className="text-[9px] font-mono uppercase text-muted-foreground">Arama Sütunu</Label>
                                  <select 
                                    value={source.config.searchCol} 
                                    onChange={(e) => updateSourceConfig(idx, 'searchCol', e.target.value)}
                                    className="w-full h-8 bg-white border border-border rounded px-2 font-mono text-[10px] outline-none focus:border-accent"
                                  >
                                    <option value="">Seçiniz...</option>
                                    {source.headers.map((h, hIdx) => <option key={`${h}-${hIdx}`} value={h}>{h}</option>)}
                                  </select>
                                </div>
                                {idx < 3 ? (
                                  <div className="space-y-1.5">
                                    <Label className="text-[9px] font-mono uppercase text-muted-foreground">Fiyat Sütunu</Label>
                                    <select 
                                      value={source.config.priceCol} 
                                      onChange={(e) => updateSourceConfig(idx, 'priceCol', e.target.value)}
                                      className="w-full h-8 bg-white border border-border rounded px-2 font-mono text-[10px] outline-none focus:border-accent"
                                    >
                                      <option value="">Seçiniz...</option>
                                      {source.headers.map((h, hIdx) => <option key={`${h}-${hIdx}`} value={h}>{h}</option>)}
                                    </select>
                                  </div>
                                ) : (
                                  <div className="col-span-2 space-y-2">
                                    <Label className="text-[9px] font-mono uppercase text-muted-foreground">Gösterilecek Sütunlar (7 Adet)</Label>
                                    <div className="grid grid-cols-1 gap-2">
                                      {Array.from({ length: 7 }).map((_, dIdx) => (
                                        <select 
                                          key={dIdx}
                                          value={source.config.displayCols?.[dIdx] || ''} 
                                          onChange={(e) => updateSourceConfig(idx, 'displayCols', e.target.value, dIdx)}
                                          className="w-full h-8 bg-white border border-border rounded px-2 font-mono text-[10px] outline-none focus:border-accent"
                                        >
                                          <option value="">Sütun {dIdx + 1} Seçiniz...</option>
                                          {source.headers.map((h, hIdx) => <option key={`${h}-${hIdx}`} value={h}>{h}</option>)}
                                        </select>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="relative group">
                            <input
                              type="file"
                              accept=".xlsx, .xls, .csv"
                              onChange={(e) => handleFileUpload(e, idx)}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                            />
                            <div className="border border-dashed border-accent/20 rounded p-4 flex flex-col items-center justify-center gap-1 bg-white group-hover:bg-accent/5 transition-all">
                              <Upload size={16} className="text-accent/40" />
                              <p className="text-[9px] font-mono uppercase text-accent/60 font-medium">
                                {source.fileName ? source.fileName : `${SOURCE_NAMES[idx]} Yükle`}
                              </p>
                            </div>
                          </div>
                          
                          {source.fileName && (
                            <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/5 border border-green-500/10">
                              <CheckCircle2 size={10} className="text-green-500" />
                              <span className="text-[8px] font-mono text-green-600 uppercase">Aktif ({databases[idx].size} Kayıt)</span>
                              {isDbLoading && <RefreshCw size={8} className="animate-spin text-accent ml-auto" />}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          </>
        )}
      </Card>
    </div>
  );
}
