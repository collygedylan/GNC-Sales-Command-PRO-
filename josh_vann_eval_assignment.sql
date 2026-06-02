-- Assign Josh Vann's exact eval rows from G:/My Drive/Plant group itemcode/Book1.xlsx, sheet Josh.
-- Drive Mode still loads all rows; assignedto controls which rows Josh can edit and sees in Tasks.
-- Generated from 233 distinct itemcode/locationcode/plantgroupcode/commonname/contsize/source keys.

begin;

create or replace function pg_temp.tmp_eval_assignment_norm(value text)
returns text
language sql
immutable
as $$
    select upper(btrim(
        replace(
            replace(
                replace(
                    replace(coalesce(value, ''), U&'\00C2\00AE', U&'\00AE'),
                    U&'\00E2\201E\00A2',
                    U&'\2122'
                ),
                U&'\00C2\2122',
                U&'\2122'
            ),
            U&'\00E2\20AC\2122',
            chr(39)
        )
    ))
$$;

create temp table tmp_josh_vann_eval_assignments as
select *
from jsonb_to_recordset($json$[
  {
    "itemcode": "000880.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "000880.010.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "000880.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "000880.030.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "000880.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "000880.050.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "000880.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Chicagoland Green® Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001675.010.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001675.010.1",
    "locationcode": "E.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001675.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001675.010.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001675.010.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001675.020.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "C.11.049",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "C.15.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "E.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001675.030.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "F.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001675.050.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001675.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001675.070.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001675.070.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Winter Gem Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001677.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001677.010.1",
    "locationcode": "E.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001677.020.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "itemcode": "001677.020.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001677.030.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001677.030.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001677.030.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001677.030.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001677.030.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001677.050.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "E.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001677.070.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Velvet Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001682.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001682.020.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001682.030.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001682.030.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001682.030.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001682.050.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001682.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001682.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#7",
    "source": "BR"
  },
  {
    "itemcode": "001682.070.1",
    "locationcode": "E.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001700.010.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001700.010.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001700.010.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001700.010.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#1",
    "source": "BR"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001700.030.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "001700.030.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001700.030.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001700.030.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001700.030.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "LD"
  },
  {
    "itemcode": "001700.050.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001700.070.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001700.070.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001700.070.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Wintergreen Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001720.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001720.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001720.020.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001720.020.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001720.020.1",
    "locationcode": "E.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001720.030.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001720.030.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#3",
    "source": "BR"
  },
  {
    "itemcode": "001720.030.1",
    "locationcode": "I.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "001720.050.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Jewel Boxwood",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "001884.008.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "itemcode": "001884.008.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "itemcode": "001884.008.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "itemcode": "001884.008.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "8 IN.",
    "source": "LD"
  },
  {
    "itemcode": "001884.010.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1",
    "source": "BR"
  },
  {
    "itemcode": "001884.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001884.010.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001884.010.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "E.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.011.1",
    "locationcode": "H.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "001884.020.1",
    "locationcode": "G.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "001884.020.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#2",
    "source": "BR"
  },
  {
    "itemcode": "001884.021.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.021.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.021.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.021.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.021.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "2DP",
    "source": "BR"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.23.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "E.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "F.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "G.18.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "G.22.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "H.13.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.031.1",
    "locationcode": "I.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "D.31.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "BR"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "SH"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.051.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "5DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.070.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001884.070.1",
    "locationcode": "D.28.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001884.070.1",
    "locationcode": "D.30.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001884.070.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#7",
    "source": "SH"
  },
  {
    "itemcode": "001884.081.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "8DP",
    "source": "LD"
  },
  {
    "itemcode": "001884.150.1",
    "locationcode": "D.20.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood",
    "contsize": "#15",
    "source": "SH"
  },
  {
    "itemcode": "003150.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "003150.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "003150.021.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "003150.021.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "003150.031.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "003150.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "003150.031.1",
    "locationcode": "E.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "003150.031.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "003150.031.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Golden Dream Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "004102.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "004102.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "004102.030.1",
    "locationcode": "E.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "004102.030.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "004102.031.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "004102.031.1",
    "locationcode": "C.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "004102.031.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Borders™ Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "005629.031.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Emerald Knoll® Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "005844.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "#3",
    "source": "SH"
  },
  {
    "itemcode": "005844.031.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "itemcode": "005844.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "005844.031.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "005844.031.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "005844.031.1",
    "locationcode": "G.24.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "005844.051.1",
    "locationcode": "B.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Shadow Sentry™ Boxwood",
    "contsize": "5DP",
    "source": "BR"
  },
  {
    "itemcode": "006163.031.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "North Star® Boxwood",
    "contsize": "3DP",
    "source": "BR"
  },
  {
    "itemcode": "006163.031.1",
    "locationcode": "E.07.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "North Star® Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "006163.051.1",
    "locationcode": "B.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "North Star® Boxwood",
    "contsize": "5DP",
    "source": "BR"
  },
  {
    "itemcode": "006736.030.1",
    "locationcode": "C.11.051",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Faulkner Boxwood",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "itemcode": "007656.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood 2-Tier Poodle",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "008404.010.1",
    "locationcode": "C.11.034",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Beauty Boxwood",
    "contsize": "#1",
    "source": "NC"
  },
  {
    "itemcode": "008404.030.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Beauty Boxwood",
    "contsize": "#3",
    "source": "NC"
  },
  {
    "itemcode": "008497.010.1",
    "locationcode": "B.03.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "008497.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "008497.010.1",
    "locationcode": "E.09.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "008497.031.1",
    "locationcode": "D.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "008497.031.1",
    "locationcode": "D.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "008497.031.1",
    "locationcode": "E.11.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "008497.031.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Independence® Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "008498.031.1",
    "locationcode": "C.11.049",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Freedom® Boxwood",
    "contsize": "3DP",
    "source": "NC"
  },
  {
    "itemcode": "009245.011.1",
    "locationcode": "E.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Little Missy Boxwood",
    "contsize": "#1D",
    "source": "LD"
  },
  {
    "itemcode": "009245.021.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Little Missy Boxwood",
    "contsize": "2DP",
    "source": "LD"
  },
  {
    "itemcode": "009245.031.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Little Missy Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "010085.010.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "N/SP Green Velvet Boxwood Pure Strain",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "010327.031.1",
    "locationcode": "H.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Baby Gem Boxwood Cone",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "010515.020.1",
    "locationcode": "A.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "010515.030.1",
    "locationcode": "G.10.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "010515.030.1",
    "locationcode": "H.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "010515.030.1",
    "locationcode": "H.04.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood",
    "contsize": "#3",
    "source": "LD"
  },
  {
    "itemcode": "010663.010.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Liberty Belle™ Boxwood",
    "contsize": "#1",
    "source": "LD"
  },
  {
    "itemcode": "010663.031.1",
    "locationcode": "B.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Liberty Belle™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "010663.031.1",
    "locationcode": "D.33.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Liberty Belle™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  },
  {
    "itemcode": "010663.031.1",
    "locationcode": "E.12.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Liberty Belle™ Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "010663.031.1",
    "locationcode": "E.14.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "NewGen™ Liberty Belle™ Boxwood",
    "contsize": "3DP",
    "source": "SH"
  },
  {
    "itemcode": "010818.020.1",
    "locationcode": "A.02.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood -Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "010818.020.1",
    "locationcode": "B.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood -Staked",
    "contsize": "#2",
    "source": "LD"
  },
  {
    "itemcode": "010818.050.1",
    "locationcode": "E.08.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Unraveled Weeping Boxwood -Staked",
    "contsize": "#5",
    "source": "SH"
  },
  {
    "itemcode": "010888.050.1",
    "locationcode": "A.01.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "Green Mountain Boxwood Patio Tree",
    "contsize": "#5",
    "source": "BR"
  },
  {
    "itemcode": "011248.031.1",
    "locationcode": "G.17.000",
    "plantgroupcode": "130_SHRUB",
    "commonname": "N/SP Border Baby™ Boxwood",
    "contsize": "3DP",
    "source": "LD"
  }
]$json$::jsonb) as x(
    itemcode text,
    locationcode text,
    plantgroupcode text,
    commonname text,
    contsize text,
    source text
);

create index on tmp_josh_vann_eval_assignments (
    pg_temp.tmp_eval_assignment_norm(itemcode),
    pg_temp.tmp_eval_assignment_norm(locationcode),
    pg_temp.tmp_eval_assignment_norm(plantgroupcode),
    pg_temp.tmp_eval_assignment_norm(commonname),
    pg_temp.tmp_eval_assignment_norm(contsize),
    pg_temp.tmp_eval_assignment_norm(source)
);

-- Remove Josh only from rows that no longer match his exact assignment sheet.
update public.v2_master_inventory m
set assignedto = null
where lower(btrim(coalesce(m.assignedto, ''))) = 'josh_vann'
  and not exists (
    select 1
    from tmp_josh_vann_eval_assignments a
    where pg_temp.tmp_eval_assignment_norm(m.itemcode) = pg_temp.tmp_eval_assignment_norm(a.itemcode)
      and pg_temp.tmp_eval_assignment_norm(m.locationcode) = pg_temp.tmp_eval_assignment_norm(a.locationcode)
      and pg_temp.tmp_eval_assignment_norm(m.plantgroupcode) = pg_temp.tmp_eval_assignment_norm(a.plantgroupcode)
      and pg_temp.tmp_eval_assignment_norm(m.commonname) = pg_temp.tmp_eval_assignment_norm(a.commonname)
      and pg_temp.tmp_eval_assignment_norm(m.contsize) = pg_temp.tmp_eval_assignment_norm(a.contsize)
      and pg_temp.tmp_eval_assignment_norm(m.source) = pg_temp.tmp_eval_assignment_norm(a.source)
  );

-- Assign Josh to the exact rows listed in the sheet.
update public.v2_master_inventory m
set assignedto = 'josh_vann'
from tmp_josh_vann_eval_assignments a
where pg_temp.tmp_eval_assignment_norm(m.itemcode) = pg_temp.tmp_eval_assignment_norm(a.itemcode)
  and pg_temp.tmp_eval_assignment_norm(m.locationcode) = pg_temp.tmp_eval_assignment_norm(a.locationcode)
  and pg_temp.tmp_eval_assignment_norm(m.plantgroupcode) = pg_temp.tmp_eval_assignment_norm(a.plantgroupcode)
  and pg_temp.tmp_eval_assignment_norm(m.commonname) = pg_temp.tmp_eval_assignment_norm(a.commonname)
  and pg_temp.tmp_eval_assignment_norm(m.contsize) = pg_temp.tmp_eval_assignment_norm(a.contsize)
  and pg_temp.tmp_eval_assignment_norm(m.source) = pg_temp.tmp_eval_assignment_norm(a.source);

-- Optional verification after running:
-- select assignedto, count(*) as row_count
-- from public.v2_master_inventory
-- where lower(btrim(coalesce(assignedto, ''))) = 'josh_vann'
-- group by assignedto;

commit;
