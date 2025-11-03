import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, Trash2, Database, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import * as XLSX from "xlsx";

// === Types ===
export type InventoryRow = {
  patrimonio: string;
  equip: string;
  local: string;
  fabricante: string;
  modelo: string;
  usuario: string;
  createdAt: number; // epoch ms
};

// === Helpers ===
const STORAGE_KEY = "inventario_rows_v1";

function loadRows(): InventoryRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as InventoryRow[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRows(rows: InventoryRow[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
}

function downloadBlob(filename: string, mime: string, data: BlobPart) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCSV(rows: InventoryRow[]): string {
  const header = [
    "PATRIMONIO",
    "EQUIP",
    "LOCAL",
    "FABRICANTE",
    "MODELO",
    "USUARIO",
    "CRIADO_EM",
  ];
  const lines = rows.map((r) =>
    [
      r.patrimonio,
      r.equip,
      r.local,
      r.fabricante,
      r.modelo,
      r.usuario,
      new Date(r.createdAt).toISOString(),
    ]
      .map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`)
      .join(",")
  );
  return header.join(",") + "\n" + lines.join("\n");
}

function toXLSXBlob(rows: InventoryRow[]): Blob {
  const wb = XLSX.utils.book_new();

  // === ABA 1: DADOS COMPLETOS ===
  const data = rows.map((r) => ({
    EQUIPAMENTO: r.equip || "-",
    PATRIMONIO: r.patrimonio || "-",
    LOCAL: r.local || "-",
    FABRICANTE: r.fabricante || "-",
    MODELO: r.modelo || "-",
    USUARIO: r.usuario || "-",
    CRIADO_EM: new Date(r.createdAt).toLocaleString("pt-BR"),
  }));
  const ws1 = XLSX.utils.json_to_sheet(data);
  const cols1 = Object.keys(data[0] || {}).map((k) => ({
    wch:
      Math.max(k.length, ...data.map((row: any) => String(row[k]).length)) + 2,
  }));
  ws1["!cols"] = cols1;
  XLSX.utils.book_append_sheet(wb, ws1, "Inventário Completo");

  // === ABA 2: MÉTRICAS GERAIS ===
  const totalItems = rows.length;
  const uniqueUsers = new Set(rows.map((r) => r.usuario).filter(Boolean)).size;
  const totalEquipments = rows.filter((r) => r.equip).length;

  // Contagem por equipamento
  const equipCount: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.equip) {
      equipCount[r.equip] = (equipCount[r.equip] || 0) + 1;
    }
  });

  // Contagem por local
  const locationCount: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.local) {
      locationCount[r.local] = (locationCount[r.local] || 0) + 1;
    }
  });

  const metricsData = [
    { MÉTRICA: "Total de Registros", VALOR: totalItems },
    { MÉTRICA: "Total de Equipamentos", VALOR: totalEquipments },
    { MÉTRICA: "Pessoas com Equipamentos", VALOR: uniqueUsers },
    { MÉTRICA: "", VALOR: "" },
    { MÉTRICA: "=== EQUIPAMENTOS POR TIPO ===", VALOR: "" },
    ...Object.entries(equipCount).map(([equip, count]) => ({
      MÉTRICA: equip,
      VALOR: count,
    })),
    { MÉTRICA: "", VALOR: "" },
    { MÉTRICA: "=== EQUIPAMENTOS POR LOCAL ===", VALOR: "" },
    ...Object.entries(locationCount).map(([local, count]) => ({
      MÉTRICA: local,
      VALOR: count,
    })),
  ];

  const ws2 = XLSX.utils.json_to_sheet(metricsData);
  ws2["!cols"] = [{ wch: 35 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Métricas Gerais");

  // === ABA 3: EQUIPAMENTOS POR TIPO ===
  const equipByType = Object.entries(equipCount)
    .map(([tipo, total]) => ({ TIPO_EQUIPAMENTO: tipo, QUANTIDADE: total }))
    .sort((a, b) => b.QUANTIDADE - a.QUANTIDADE);

  if (equipByType.length > 0) {
    const ws3 = XLSX.utils.json_to_sheet(equipByType);
    ws3["!cols"] = [{ wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws3, "Por Tipo");
  }

  // === ABA 4: EQUIPAMENTOS POR LOCAL ===
  const equipByLocation: any[] = [];
  Object.keys(locationCount).forEach((local) => {
    const localRows = rows.filter((r) => r.local === local);
    const equipInLocation: Record<string, number> = {};
    localRows.forEach((r) => {
      if (r.equip) {
        equipInLocation[r.equip] = (equipInLocation[r.equip] || 0) + 1;
      }
    });

    Object.entries(equipInLocation).forEach(([equip, count]) => {
      equipByLocation.push({
        LOCAL: local,
        EQUIPAMENTO: equip,
        QUANTIDADE: count,
      });
    });
  });

  if (equipByLocation.length > 0) {
    const ws4 = XLSX.utils.json_to_sheet(equipByLocation);
    ws4["!cols"] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws4, "Por Local");
  }

  // === ABA 5: EQUIPAMENTOS POR USUÁRIO ===
  const userEquipments: Record<
    string,
    { equipamentos: string[]; total: number }
  > = {};
  rows.forEach((r) => {
    if (r.usuario && r.equip) {
      if (!userEquipments[r.usuario]) {
        userEquipments[r.usuario] = { equipamentos: [], total: 0 };
      }
      userEquipments[r.usuario].equipamentos.push(r.equip);
      userEquipments[r.usuario].total++;
    }
  });

  const userEquipData = Object.entries(userEquipments)
    .map(([usuario, data]) => ({
      USUARIO: usuario,
      TOTAL_EQUIPAMENTOS: data.total,
      EQUIPAMENTOS: data.equipamentos.join(", "),
    }))
    .sort((a, b) => b.TOTAL_EQUIPAMENTOS - a.TOTAL_EQUIPAMENTOS);

  if (userEquipData.length > 0) {
    const ws5 = XLSX.utils.json_to_sheet(userEquipData);
    ws5["!cols"] = [{ wch: 25 }, { wch: 18 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, ws5, "Por Usuário");
  }

  // === ABA 6: FABRICANTES ===
  const fabricanteCount: Record<string, number> = {};
  rows.forEach((r) => {
    if (r.fabricante) {
      fabricanteCount[r.fabricante] = (fabricanteCount[r.fabricante] || 0) + 1;
    }
  });

  const fabricanteData = Object.entries(fabricanteCount)
    .map(([fabricante, total]) => ({
      FABRICANTE: fabricante,
      QUANTIDADE: total,
    }))
    .sort((a, b) => b.QUANTIDADE - a.QUANTIDADE);

  if (fabricanteData.length > 0) {
    const ws6 = XLSX.utils.json_to_sheet(fabricanteData);
    ws6["!cols"] = [{ wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws6, "Fabricantes");
  }

  const wbout = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([wbout], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

// === UI ===
export default function App() {
  const [rows, setRows] = useState<InventoryRow[]>(() => loadRows());
  const [step, setStep] = useState<number>(0);
  const [current, setCurrent] = useState<Omit<InventoryRow, "createdAt">>({
    patrimonio: "",
    equip: "",
    local: "",
    fabricante: "Dell",
    modelo: "",
    usuario: "",
  });
  const [autofocus, setAutofocus] = useState(true);
  const [compact, setCompact] = useState(true);

  // Opções de equipamentos pré-definidas
  const equipmentOptions = ["Notebook", "Mouse", "Teclado", "Fone", "Monitor"];

  // Autosave
  useEffect(() => {
    saveRows(rows);
  }, [rows]);

  // Prevent data loss (before unload)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (rows.length > 0 || Object.values(current).some(Boolean)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [rows, current]);

  const fields = useMemo(
    () =>
      [
        {
          key: "equip",
          label: "Equipamento",
          placeholder: "Ex: Notebook, Monitor...",
        },
        { key: "patrimonio", label: "Patrimônio", placeholder: "Ex: 000123" },
        {
          key: "local",
          label: "Local",
          placeholder: "Ex: Mesa 12, TI, Recepção",
        },
        {
          key: "fabricante",
          label: "Fabricante",
          placeholder: "Ex: Dell, HP, Positivo",
        },
        { key: "modelo", label: "Modelo", placeholder: "Ex: Inspiron 15 3520" },
        { key: "usuario", label: "Usuário", placeholder: "Ex: Maria Silva" },
      ] as const,
    []
  );

  const activeField = fields[step % fields.length];
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (autofocus) inputRef.current?.focus();
  }, [step, autofocus]);

  function submitField(value: string) {
    // Move to next field, or save row when last field is done
    const next = { ...current, [activeField.key]: value } as any;
    setCurrent(next);
    const isLast = step % fields.length === fields.length - 1;
    if (isLast) {
      const row: InventoryRow = {
        ...next,
        createdAt: Date.now(),
      } as InventoryRow;
      setRows((prev) => [row, ...prev]);
      setCurrent({
        patrimonio: "",
        equip: "",
        local: "",
        fabricante: "Dell",
        modelo: "",
        usuario: "",
      });
      setStep(0);
      toast.success("Item adicionado!");
    } else {
      setStep((prev) => prev + 1);
    }
  }

  function backStep() {
    if (step === 0) return;
    setStep((prev) => prev - 1);
  }

  function handleQuickAdd() {
    const allEmpty = Object.values(current).every((v) => !v);
    if (allEmpty) return toast.error("Preencha pelo menos um campo");
    const row: InventoryRow = {
      ...current,
      createdAt: Date.now(),
    } as InventoryRow;
    setRows((prev) => [row, ...prev]);
    setCurrent({
      patrimonio: "",
      equip: "",
      local: "",
      fabricante: "Dell",
      modelo: "",
      usuario: "",
    });
    setStep(0);
    toast.success("Item salvo (adição rápida)");
  }

  function exportCSV() {
    if (!rows.length) return toast.error("Nada para exportar");
    const csv = toCSV(rows);
    downloadBlob(
      `inventario_${new Date().toISOString().slice(0, 10)}.csv`,
      "text/csv;charset=utf-8;",
      csv
    );
    toast.success("CSV gerado");
  }

  function exportXLSX() {
    if (!rows.length) return toast.error("Nada para exportar");
    const blob = toXLSXBlob(rows);
    downloadBlob(
      `inventario_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      blob
    );
    toast.success("Excel gerado");
  }

  function clearAll() {
    if (!confirm("Tem certeza que deseja apagar TODOS os registros locais?"))
      return;
    setRows([]);
    toast.success("Registros apagados do dispositivo");
  }

  // Backup / Restore JSON
  function backupJSON() {
    const payload = { version: 1, exportedAt: new Date().toISOString(), rows };
    downloadBlob(
      `backup_inventario_${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
      JSON.stringify(payload, null, 2)
    );
    toast.success("Backup baixado");
  }

  function restoreJSON(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || "{}"));
        if (!Array.isArray(data.rows)) throw new Error("arquivo inválido");
        setRows((prev) => [...data.rows, ...prev]);
        toast.success("Backup restaurado");
      } catch (e) {
        toast.error("Falha ao restaurar backup");
      }
    };
    reader.readAsText(file);
  }

  // UI sizes
  const pad = compact ? "p-3" : "p-6";

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <Toaster richColors />

      <header className="sticky top-0 z-40 backdrop-blur bg-white/70 border-b">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-2 p-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            <span className="font-semibold">Inventário Rápido</span>
            <span className="text-xs text-neutral-500">(offline-first)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="compact" className="text-xs">
                Compacto
              </Label>
              <Switch
                id="compact"
                checked={compact}
                onCheckedChange={setCompact}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="autofocus" className="text-xs">
                Auto foco
              </Label>
              <Switch
                id="autofocus"
                checked={autofocus}
                onCheckedChange={setAutofocus}
              />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-3 space-y-4">
        {/* Stepper Card */}
        <Card className="border-neutral-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Passo {(step % fields.length) + 1} de {fields.length}:{" "}
              {activeField.label}
            </CardTitle>
          </CardHeader>
          <CardContent className={`grid gap-3 ${pad}`}>
            <div className="grid gap-1">
              <Label className="text-sm" htmlFor="active">
                {activeField.label}
              </Label>
              {activeField.key === "equip" ? (
                <Select
                  id="active"
                  value={(current as any)[activeField.key]}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                    setCurrent((c) => ({
                      ...c,
                      [activeField.key]: e.target.value,
                    }))
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLSelectElement>) => {
                    if (e.key === "Enter")
                      submitField((e.target as HTMLSelectElement).value);
                    if (e.key === "Escape") backStep();
                  }}
                  className="text-base"
                >
                  <option value="">Selecione um equipamento...</option>
                  {equipmentOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  id="active"
                  ref={inputRef}
                  inputMode="text"
                  placeholder={activeField.placeholder}
                  value={(current as any)[activeField.key]}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setCurrent((c) => ({
                      ...c,
                      [activeField.key]: e.target.value,
                    }))
                  }
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === "Enter")
                      submitField((e.target as HTMLInputElement).value);
                    if (e.key === "Escape") backStep();
                  }}
                  className="text-base h-12"
                />
              )}
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Dica: Enter para avançar • Esc para voltar</span>
                <span className="uppercase tracking-wide">
                  {activeField.key}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => backStep()}
                variant="secondary"
              >
                Voltar
              </Button>
              <Button
                className="flex-1"
                onClick={() =>
                  submitField((current as any)[activeField.key] || "")
                }
              >
                Avançar
              </Button>
            </div>
            <Button variant="ghost" onClick={handleQuickAdd} className="w-full">
              Salvar item (adição rápida)
            </Button>
          </CardContent>
          <CardFooter className={`flex flex-wrap gap-2 ${pad}`}>
            <Button onClick={exportCSV} className="gap-2">
              <Download className="w-4 h-4" /> CSV
            </Button>
            <Button onClick={exportXLSX} className="gap-2" variant="outline">
              <Download className="w-4 h-4" /> Excel
            </Button>
            <Button onClick={backupJSON} className="gap-2" variant="outline">
              <Database className="w-4 h-4" /> Backup JSON
            </Button>
            <label className="inline-flex items-center gap-2 cursor-pointer text-sm px-3 py-2 border rounded-lg hover:bg-neutral-50">
              <Upload className="w-4 h-4" /> Restaurar
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) restoreJSON(f);
                  e.currentTarget.value = "";
                }}
              />
            </label>
            <Button onClick={clearAll} className="gap-2" variant="destructive">
              <Trash2 className="w-4 h-4" /> Limpar tudo
            </Button>
          </CardFooter>
        </Card>

        {/* Preview List */}
        <Card className="border-neutral-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Registros ({rows.length})
            </CardTitle>
          </CardHeader>
          <CardContent className={pad}>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Nenhum item ainda. Comece pelo formulário acima.
              </p>
            ) : (
              <div className="w-full overflow-x-auto overflow-y-auto max-h-[500px] border rounded-lg">
                <table className="w-full min-w-[800px]">
                  <thead className="bg-neutral-50 sticky top-0 z-10">
                    <tr className="border-b">
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        EQUIPAMENTO
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        PATRIMÔNIO
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        LOCAL
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        FABRICANTE
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        MODELO
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        USUÁRIO
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        CRIADO EM
                      </th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-neutral-600 whitespace-nowrap">
                        AÇÕES
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y bg-white">
                    <AnimatePresence initial={false}>
                      {rows.map((r, i) => (
                        <motion.tr
                          key={r.createdAt + "_" + i}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="hover:bg-neutral-50 transition-colors"
                        >
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.equip || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.patrimonio || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.local || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.fabricante || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.modelo || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {r.usuario || "-"}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleString("pt-BR")}
                          </td>
                          <td className="px-3 py-2 text-sm whitespace-nowrap text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setRows((prev) =>
                                  prev.filter((_, idx) => idx !== i)
                                );
                                toast.success("Item removido");
                              }}
                              className="h-7 w-7 p-0 hover:bg-red-50 hover:text-red-600"
                              title="Remover item"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer tips */}
        <div className="text-[11px] text-neutral-500 text-center pb-8">
          Dica: use como PWA adicionando à tela inicial do celular para abrir em
          tela cheia. Dados ficam no seu dispositivo (localStorage).
        </div>
      </main>
    </div>
  );
}
