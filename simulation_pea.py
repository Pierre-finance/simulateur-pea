def simulate_pea(versement_mensuel=200, taux_annuel=0.07, duree_ans=20):
    taux_mensuel = taux_annuel / 12
    total_mois = duree_ans * 12

    capital = 0
    for _ in range(total_mois):
        capital = (capital + versement_mensuel) * (1 + taux_mensuel)

    capital_verse = versement_mensuel * total_mois
    interets = capital - capital_verse

    print("=" * 45)
    print("   SIMULATION PEA - ÉPARGNE MENSUELLE")
    print("=" * 45)
    print(f"  Versement mensuel   : {versement_mensuel:>10.2f} €")
    print(f"  Rendement annuel    : {taux_annuel * 100:>9.1f} %")
    print(f"  Durée               : {duree_ans:>9} ans")
    print("-" * 45)
    print(f"  Capital versé       : {capital_verse:>10,.2f} €")
    print(f"  Intérêts gagnés     : {interets:>10,.2f} €")
    print(f"  MONTANT FINAL       : {capital:>10,.2f} €")
    print(f"  Multiplicateur      : {capital / capital_verse:>9.2f} x")
    print("=" * 45)


if __name__ == "__main__":
    simulate_pea()
