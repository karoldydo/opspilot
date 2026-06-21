/10x-research post-flow-analysis Przeanalizuj proces zapisu postów, zwracając szczególną uwagę na powiązane z nim obszary zdefiniowane w context/map/repo-map.md

Wykorzystaj trzech równoległych sub-agentów:

1. Trace e2e: odtwórz ścieżkę od entry pointu, przez warstwy, do zapisu/odczytu
   i z powrotem. Daj sekwencję kroków z file:line oraz diagram Mermaid.
2. Luki w testach: które metody i gałęzie na tej ścieżce mają pokrycie,
   a które nie.
3. Blast radius: co musi zmienić się razem przy zmianie tego przepływu — szew
   interfejsu, warstwy generowane, model, migracje, testy. Połącz graf statyczny
   z co-change z historii gita.

Skup się wyłącznie na analizie i opisie stanu obecnego repozytorium.

Twój raport musi zawierać dwie jawne i krytyczne sekcje:

1. Feature overview
2. Technical debt

Zapisz wnioski z badania do context/changes/post-flow-analysis/research.md
