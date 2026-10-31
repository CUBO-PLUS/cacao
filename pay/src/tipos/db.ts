export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      auditoria: {
        Row: {
          accion: string
          actor_id: string | null
          creado_en: string
          detalle: Json
          entidad: string
          entidad_id: string
          id: number
        }
        Insert: {
          accion: string
          actor_id?: string | null
          creado_en?: string
          detalle?: Json
          entidad: string
          entidad_id: string
          id?: never
        }
        Update: {
          accion?: string
          actor_id?: string | null
          creado_en?: string
          detalle?: Json
          entidad?: string
          entidad_id?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      avisos: {
        Row: {
          creado_en: string
          id: string
          leido: boolean
          orden_id: string | null
          ruta: string | null
          texto: string
          tipo: string
          usuario_id: string
        }
        Insert: {
          creado_en?: string
          id?: string
          leido?: boolean
          orden_id?: string | null
          ruta?: string | null
          texto: string
          tipo: string
          usuario_id: string
        }
        Update: {
          creado_en?: string
          id?: string
          leido?: boolean
          orden_id?: string | null
          ruta?: string | null
          texto?: string
          tipo?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          id: number
          nombre: string
          orden: number
        }
        Insert: {
          id?: never
          nombre: string
          orden?: number
        }
        Update: {
          id?: never
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      categorias_servicio: {
        Row: {
          id: number
          nombre: string
          orden: number
        }
        Insert: {
          id?: never
          nombre: string
          orden?: number
        }
        Update: {
          id?: never
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      cobros: {
        Row: {
          bolt11: string | null
          destino: string | null
          estado: Database["public"]["Enums"]["estado_cobro"]
          expira_en: string
          id: string
          orden_id: string
          pagado_en: string | null
          proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          referencia_externa: string | null
          verificar_url: string | null
        }
        Insert: {
          bolt11?: string | null
          destino?: string | null
          estado?: Database["public"]["Enums"]["estado_cobro"]
          expira_en: string
          id?: string
          orden_id: string
          pagado_en?: string | null
          proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          referencia_externa?: string | null
          verificar_url?: string | null
        }
        Update: {
          bolt11?: string | null
          destino?: string | null
          estado?: Database["public"]["Enums"]["estado_cobro"]
          expira_en?: string
          id?: string
          orden_id?: string
          pagado_en?: string | null
          proveedor?: Database["public"]["Enums"]["tipo_proveedor"]
          referencia_externa?: string | null
          verificar_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cobros_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
        ]
      }
      config_publica: {
        Row: {
          actualizado_en: string
          clave: string
          valor: string
        }
        Insert: {
          actualizado_en?: string
          clave: string
          valor: string
        }
        Update: {
          actualizado_en?: string
          clave?: string
          valor?: string
        }
        Relationships: []
      }
      cotizaciones: {
        Row: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        Insert: {
          cliente_id: string
          creada_en?: string
          descripcion_cliente?: string
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          id?: string
          mensaje?: string
          necesidad_id?: string | null
          negocio_id: string
          orden_id?: string | null
          precio_usd_centavos?: number | null
          respondida_en?: string | null
          servicio_id?: string | null
        }
        Update: {
          cliente_id?: string
          creada_en?: string
          descripcion_cliente?: string
          estado?: Database["public"]["Enums"]["estado_cotizacion"]
          id?: string
          mensaje?: string
          necesidad_id?: string | null
          negocio_id?: string
          orden_id?: string | null
          precio_usd_centavos?: number | null
          respondida_en?: string | null
          servicio_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_necesidad_id_fkey"
            columns: ["necesidad_id"]
            isOneToOne: false
            referencedRelation: "necesidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "cotizaciones_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      disputas: {
        Row: {
          creada_en: string
          estado: Database["public"]["Enums"]["estado_disputa"]
          evidencia: string
          id: string
          motivo: string
          nota_resolucion: string
          orden_id: string
          reembolso_confirmado_en: string | null
          reembolso_marcado_en: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          resultado: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        Insert: {
          creada_en?: string
          estado?: Database["public"]["Enums"]["estado_disputa"]
          evidencia?: string
          id?: string
          motivo: string
          nota_resolucion?: string
          orden_id: string
          reembolso_confirmado_en?: string | null
          reembolso_marcado_en?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          resultado?: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        Update: {
          creada_en?: string
          estado?: Database["public"]["Enums"]["estado_disputa"]
          evidencia?: string
          id?: string
          motivo?: string
          nota_resolucion?: string
          orden_id?: string
          reembolso_confirmado_en?: string | null
          reembolso_marcado_en?: string | null
          resuelta_en?: string | null
          resuelta_por?: string | null
          resultado?: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        Relationships: [
          {
            foreignKeyName: "disputas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disputas_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos: {
        Row: {
          creado_en: string
          hora: string
          id: number
          nombre: string
          objeto: string | null
          ruta: string
          sesion: string
          sitio: string
          usuario_id: string | null
          valor_usd_centavos: number | null
        }
        Insert: {
          creado_en?: string
          hora?: string
          id?: never
          nombre: string
          objeto?: string | null
          ruta?: string
          sesion: string
          sitio: string
          usuario_id?: string | null
          valor_usd_centavos?: number | null
        }
        Update: {
          creado_en?: string
          hora?: string
          id?: never
          nombre?: string
          objeto?: string | null
          ruta?: string
          sesion?: string
          sitio?: string
          usuario_id?: string | null
          valor_usd_centavos?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_sitio_nombre_fkey"
            columns: ["sitio", "nombre"]
            isOneToOne: false
            referencedRelation: "eventos_permitidos"
            referencedColumns: ["sitio", "nombre"]
          },
          {
            foreignKeyName: "eventos_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_permitidos: {
        Row: {
          etiqueta: string
          nombre: string
          orden: number
          sitio: string
        }
        Insert: {
          etiqueta: string
          nombre: string
          orden: number
          sitio: string
        }
        Update: {
          etiqueta?: string
          nombre?: string
          orden?: number
          sitio?: string
        }
        Relationships: []
      }
      ledger_candados: {
        Row: {
          dueno: string
          hasta: string
          nombre: string
        }
        Insert: {
          dueno: string
          hasta: string
          nombre: string
        }
        Update: {
          dueno?: string
          hasta?: string
          nombre?: string
        }
        Relationships: []
      }
      ledger_correlativos: {
        Row: {
          serie: string
          ultimo: number
        }
        Insert: {
          serie: string
          ultimo: number
        }
        Update: {
          serie?: string
          ultimo?: number
        }
        Relationships: []
      }
      ledger_dtes: {
        Row: {
          ambiente: string
          codigo_generacion: string
          correlativo: number | null
          creado_en: string
          documento: Json
          estado: string
          motivo: string | null
          numero_control: string
          sello: string | null
          ticket_id: string
          tipo_dte: string
        }
        Insert: {
          ambiente: string
          codigo_generacion: string
          correlativo?: number | null
          creado_en?: string
          documento: Json
          estado: string
          motivo?: string | null
          numero_control: string
          sello?: string | null
          ticket_id: string
          tipo_dte: string
        }
        Update: {
          ambiente?: string
          codigo_generacion?: string
          correlativo?: number | null
          creado_en?: string
          documento?: Json
          estado?: string
          motivo?: string | null
          numero_control?: string
          sello?: string | null
          ticket_id?: string
          tipo_dte?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_dtes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "ledger_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_sincronizaciones: {
        Row: {
          emitidos: number | null
          empezo: string
          error: string | null
          id: number
          nuevas: number | null
          omitidas: number | null
          origen: string
          rechazados: number | null
          repetidas: number | null
          termino: string | null
        }
        Insert: {
          emitidos?: number | null
          empezo?: string
          error?: string | null
          id?: number
          nuevas?: number | null
          omitidas?: number | null
          origen?: string
          rechazados?: number | null
          repetidas?: number | null
          termino?: string | null
        }
        Update: {
          emitidos?: number | null
          empezo?: string
          error?: string | null
          id?: number
          nuevas?: number | null
          omitidas?: number | null
          origen?: string
          rechazados?: number | null
          repetidas?: number | null
          termino?: string | null
        }
        Relationships: []
      }
      ledger_tickets: {
        Row: {
          buscar: string
          cliente: string
          creado_en: string
          datos: Json
          estado: string
          id: string
          origen_numero: string | null
          origen_plataforma: string | null
          pagado_en: string | null
          payment_hash: string | null
          producto: string | null
          sats: number | null
          total_centavos: number
        }
        Insert: {
          buscar?: string
          cliente: string
          creado_en: string
          datos: Json
          estado: string
          id: string
          origen_numero?: string | null
          origen_plataforma?: string | null
          pagado_en?: string | null
          payment_hash?: string | null
          producto?: string | null
          sats?: number | null
          total_centavos: number
        }
        Update: {
          buscar?: string
          cliente?: string
          creado_en?: string
          datos?: Json
          estado?: string
          id?: string
          origen_numero?: string | null
          origen_plataforma?: string | null
          pagado_en?: string | null
          payment_hash?: string | null
          producto?: string | null
          sats?: number | null
          total_centavos?: number
        }
        Relationships: []
      }
      lineas_orden: {
        Row: {
          cantidad: number
          id: string
          nombre: string
          orden_id: string
          precio_usd_centavos: number
          producto_id: string | null
          servicio_id: string | null
          unidad: string
        }
        Insert: {
          cantidad: number
          id?: string
          nombre: string
          orden_id: string
          precio_usd_centavos: number
          producto_id?: string | null
          servicio_id?: string | null
          unidad: string
        }
        Update: {
          cantidad?: number
          id?: string
          nombre?: string
          orden_id?: string
          precio_usd_centavos?: number
          producto_id?: string | null
          servicio_id?: string | null
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "lineas_orden_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_orden_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lineas_orden_servicio_id_fkey"
            columns: ["servicio_id"]
            isOneToOne: false
            referencedRelation: "servicios"
            referencedColumns: ["id"]
          },
        ]
      }
      media_accesos: {
        Row: {
          cobro_id: string
          creado_en: string
          id: string
          lector_id: string
          slug: string
        }
        Insert: {
          cobro_id: string
          creado_en?: string
          id?: string
          lector_id: string
          slug: string
        }
        Update: {
          cobro_id?: string
          creado_en?: string
          id?: string
          lector_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_accesos_cobro_id_fkey"
            columns: ["cobro_id"]
            isOneToOne: true
            referencedRelation: "media_cobros"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_accesos_lector_id_fkey"
            columns: ["lector_id"]
            isOneToOne: false
            referencedRelation: "media_lectores"
            referencedColumns: ["id"]
          },
        ]
      }
      media_cerrado: {
        Row: {
          actualizado_en: string
          html: string
          slug: string
        }
        Insert: {
          actualizado_en?: string
          html: string
          slug: string
        }
        Update: {
          actualizado_en?: string
          html?: string
          slug?: string
        }
        Relationships: []
      }
      media_cobros: {
        Row: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        Insert: {
          btcpay_factura_id?: string | null
          btcpay_tienda_id?: string | null
          cerrada_en?: string | null
          cotizacion_usd_btc: number
          creado_en?: string
          estado?: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id?: string
          lector_id: string
          motivo?: string | null
          pagada_en?: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor?: string
          slug: string
          titulo: string
        }
        Update: {
          btcpay_factura_id?: string | null
          btcpay_tienda_id?: string | null
          cerrada_en?: string | null
          cotizacion_usd_btc?: number
          creado_en?: string
          estado?: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en?: string
          factura?: string
          id?: string
          lector_id?: string
          motivo?: string | null
          pagada_en?: string | null
          precio_sats?: number
          precio_usd_centavos?: number
          proveedor?: string
          slug?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_cobros_lector_id_fkey"
            columns: ["lector_id"]
            isOneToOne: false
            referencedRelation: "media_lectores"
            referencedColumns: ["id"]
          },
        ]
      }
      media_lectores: {
        Row: {
          creado_en: string
          id: string
          visto_en: string
        }
        Insert: {
          creado_en?: string
          id?: string
          visto_en?: string
        }
        Update: {
          creado_en?: string
          id?: string
          visto_en?: string
        }
        Relationships: []
      }
      mensajes: {
        Row: {
          autor_id: string
          creado_en: string
          id: string
          orden_id: string
          texto: string
        }
        Insert: {
          autor_id: string
          creado_en?: string
          id?: string
          orden_id: string
          texto: string
        }
        Update: {
          autor_id?: string
          creado_en?: string
          id?: string
          orden_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "mensajes_autor_id_fkey"
            columns: ["autor_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensajes_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: false
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
        ]
      }
      necesidades: {
        Row: {
          categoria_id: number
          creada_en: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_necesidad"]
          id: string
          oculta: boolean
          presupuesto_usd_centavos: number | null
          titulo: string
          usuario_id: string
          vence_en: string
          zona: string
        }
        Insert: {
          categoria_id: number
          creada_en?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_necesidad"]
          id?: string
          oculta?: boolean
          presupuesto_usd_centavos?: number | null
          titulo: string
          usuario_id: string
          vence_en?: string
          zona?: string
        }
        Update: {
          categoria_id?: number
          creada_en?: string
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_necesidad"]
          id?: string
          oculta?: boolean
          presupuesto_usd_centavos?: number | null
          titulo?: string
          usuario_id?: string
          vence_en?: string
          zona?: string
        }
        Relationships: [
          {
            foreignKeyName: "necesidades_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_servicio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "necesidades_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      negocios: {
        Row: {
          abierto: boolean
          btcmap_id: number | null
          btcpay_tienda_id: string | null
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
          tipo_negocio: string | null
          tipo_proveedor_pago: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion: string
          usuario_id: string
        }
        Insert: {
          abierto?: boolean
          btcmap_id?: number | null
          btcpay_tienda_id?: string | null
          creado_en?: string
          credencial_pago_cifrada?: string | null
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_negocio"]
          id?: string
          lightning_address?: string | null
          nombre: string
          tipo_negocio?: string | null
          tipo_proveedor_pago?: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion?: string
          usuario_id: string
        }
        Update: {
          abierto?: boolean
          btcmap_id?: number | null
          btcpay_tienda_id?: string | null
          creado_en?: string
          credencial_pago_cifrada?: string | null
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_negocio"]
          id?: string
          lightning_address?: string | null
          nombre?: string
          tipo_negocio?: string | null
          tipo_proveedor_pago?: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "negocios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: true
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ordenes: {
        Row: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        Insert: {
          cancelada_en?: string | null
          cerrada_en?: string | null
          clave_idempotencia: string
          codigo_entrega?: string | null
          comision_teorica_sats?: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en?: string
          disputada_en?: string | null
          entregada_en?: string | null
          estado?: Database["public"]["Enums"]["estado_orden"]
          expirada_en?: string | null
          hecha_en?: string | null
          id?: string
          lista_en?: string | null
          modo_entrega?: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion?: string | null
          negocio_id: string
          numero?: never
          pagada_en?: string | null
          resuelta_en?: string | null
          tipo?: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        Update: {
          cancelada_en?: string | null
          cerrada_en?: string | null
          clave_idempotencia?: string
          codigo_entrega?: string | null
          comision_teorica_sats?: number
          comprador_id?: string
          cotizacion_usd_btc?: number
          creada_en?: string
          disputada_en?: string | null
          entregada_en?: string | null
          estado?: Database["public"]["Enums"]["estado_orden"]
          expirada_en?: string | null
          hecha_en?: string | null
          id?: string
          lista_en?: string | null
          modo_entrega?: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion?: string | null
          negocio_id?: string
          numero?: never
          pagada_en?: string | null
          resuelta_en?: string | null
          tipo?: Database["public"]["Enums"]["tipo_orden"]
          total_sats?: number
          total_usd_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "ordenes_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ordenes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "ordenes_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_api_clientes: {
        Row: {
          aviso_secreto: string
          clave_hash: string
          creado_en: string
          cuota_usos: number
          cuota_ventana_en: string | null
          id: string
          nombre: string
          prefijo: string
          producto: string
          puede_elegir_tienda: boolean
          revocado_en: string | null
          tienda_btcpay: string
        }
        Insert: {
          aviso_secreto: string
          clave_hash: string
          creado_en?: string
          cuota_usos?: number
          cuota_ventana_en?: string | null
          id?: string
          nombre: string
          prefijo: string
          producto: string
          puede_elegir_tienda?: boolean
          revocado_en?: string | null
          tienda_btcpay: string
        }
        Update: {
          aviso_secreto?: string
          clave_hash?: string
          creado_en?: string
          cuota_usos?: number
          cuota_ventana_en?: string | null
          id?: string
          nombre?: string
          prefijo?: string
          producto?: string
          puede_elegir_tienda?: boolean
          revocado_en?: string | null
          tienda_btcpay?: string
        }
        Relationships: []
      }
      pay_api_tiendas: {
        Row: {
          cliente_id: string
          tienda_btcpay: string
        }
        Insert: {
          cliente_id: string
          tienda_btcpay: string
        }
        Update: {
          cliente_id?: string
          tienda_btcpay?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_api_tiendas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "pay_api_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_avisos: {
        Row: {
          cobro_id: string
          creado_en: string
          entrega: string
          enviado_en: string | null
          estado: string
          id: string
          intentos: number
          muerto_en: string | null
          proximo_intento_en: string
          reclamado_hasta: string | null
          reclamo: string | null
          ultimo_error: string | null
        }
        Insert: {
          cobro_id: string
          creado_en?: string
          entrega?: string
          enviado_en?: string | null
          estado: string
          id?: string
          intentos?: number
          muerto_en?: string | null
          proximo_intento_en?: string
          reclamado_hasta?: string | null
          reclamo?: string | null
          ultimo_error?: string | null
        }
        Update: {
          cobro_id?: string
          creado_en?: string
          entrega?: string
          enviado_en?: string | null
          estado?: string
          id?: string
          intentos?: number
          muerto_en?: string | null
          proximo_intento_en?: string
          reclamado_hasta?: string | null
          reclamo?: string | null
          ultimo_error?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_avisos_cobro_id_fkey"
            columns: ["cobro_id"]
            isOneToOne: false
            referencedRelation: "pay_cobros"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_cobros: {
        Row: {
          actualizado_en: string
          aviso_url: string | null
          btcpay_factura_id: string | null
          cancelado_en: string | null
          clave_idempotencia: string
          cliente_id: string
          cotizacion_usd_btc: number
          creado_en: string
          descripcion: string
          estado: string
          expira_en: string | null
          factura: string | null
          hash_pago: string | null
          huella: string
          id: string
          moneda: string
          monto: number
          pagado_en: string | null
          pago_tardio_en: string | null
          producto: string
          referencia: string
          sats: number
          tienda_btcpay: string
          usd_centavos: number
          vence_en_segundos: number
          datos: string | null
        }
        Insert: {
          actualizado_en?: string
          aviso_url?: string | null
          btcpay_factura_id?: string | null
          cancelado_en?: string | null
          clave_idempotencia: string
          cliente_id: string
          cotizacion_usd_btc: number
          creado_en?: string
          descripcion: string
          estado?: string
          expira_en?: string | null
          factura?: string | null
          hash_pago?: string | null
          huella: string
          id?: string
          moneda: string
          monto: number
          pagado_en?: string | null
          pago_tardio_en?: string | null
          producto: string
          referencia: string
          sats: number
          tienda_btcpay: string
          usd_centavos: number
          vence_en_segundos: number
          datos?: string | null
        }
        Update: {
          actualizado_en?: string
          aviso_url?: string | null
          btcpay_factura_id?: string | null
          cancelado_en?: string | null
          clave_idempotencia?: string
          cliente_id?: string
          cotizacion_usd_btc?: number
          creado_en?: string
          descripcion?: string
          estado?: string
          expira_en?: string | null
          factura?: string | null
          hash_pago?: string | null
          huella?: string
          id?: string
          moneda?: string
          monto?: number
          pagado_en?: string | null
          pago_tardio_en?: string | null
          producto?: string
          referencia?: string
          sats?: number
          tienda_btcpay?: string
          usd_centavos?: number
          vence_en_segundos?: number
          datos?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_cobros_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "pay_api_clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_cuotas_publicas: {
        Row: {
          clave: string
          usos: number
          ventana: string
        }
        Insert: {
          clave: string
          usos: number
          ventana: string
        }
        Update: {
          clave?: string
          usos?: number
          ventana?: string
        }
        Relationships: []
      }
      pay_facturas: {
        Row: {
          btcpay_factura_id: string
          creado_en: string
          expira: string
          factura: string
          sats: number
          transferencia_id: string
        }
        Insert: {
          btcpay_factura_id: string
          creado_en?: string
          expira: string
          factura: string
          sats: number
          transferencia_id: string
        }
        Update: {
          btcpay_factura_id?: string
          creado_en?: string
          expira?: string
          factura?: string
          sats?: number
          transferencia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_facturas_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "pay_transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_historial: {
        Row: {
          creado_en: string
          detalle: string
          estado: Database["public"]["Enums"]["pay_estado"]
          id: number
          transferencia_id: string
        }
        Insert: {
          creado_en?: string
          detalle?: string
          estado: Database["public"]["Enums"]["pay_estado"]
          id?: never
          transferencia_id: string
        }
        Update: {
          creado_en?: string
          detalle?: string
          estado?: Database["public"]["Enums"]["pay_estado"]
          id?: never
          transferencia_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_historial_transferencia_id_fkey"
            columns: ["transferencia_id"]
            isOneToOne: false
            referencedRelation: "pay_transferencias"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_negocios: {
        Row: {
          activo_en: string | null
          cliente_id: string | null
          creado_en: string
          estado: string
          negocio_id: string
          reclamado_en: string | null
          tienda_btcpay: string | null
        }
        Insert: {
          activo_en?: string | null
          cliente_id?: string | null
          creado_en?: string
          estado?: string
          negocio_id: string
          reclamado_en?: string | null
          tienda_btcpay?: string | null
        }
        Update: {
          activo_en?: string | null
          cliente_id?: string | null
          creado_en?: string
          estado?: string
          negocio_id?: string
          reclamado_en?: string | null
          tienda_btcpay?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pay_negocios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: true
            referencedRelation: "pay_api_clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_negocios_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "pay_negocios_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: true
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_tarifas: {
        Row: {
          descripcion: string
          entrega: Database["public"]["Enums"]["pay_entrega"]
          fijo_centavos: number
          minutos_estimados: number
          porcentaje_bps: number
        }
        Insert: {
          descripcion: string
          entrega: Database["public"]["Enums"]["pay_entrega"]
          fijo_centavos: number
          minutos_estimados: number
          porcentaje_bps: number
        }
        Update: {
          descripcion?: string
          entrega?: Database["public"]["Enums"]["pay_entrega"]
          fijo_centavos?: number
          minutos_estimados?: number
          porcentaje_bps?: number
        }
        Relationships: []
      }
      pay_tasas: {
        Row: {
          actualizada_en: string
          fuente: string
          par: string
          tasa: number
        }
        Insert: {
          actualizada_en?: string
          fuente: string
          par: string
          tasa: number
        }
        Update: {
          actualizada_en?: string
          fuente?: string
          par?: string
          tasa?: number
        }
        Relationships: []
      }
      pay_transferencias: {
        Row: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        Insert: {
          btcpay_factura_id?: string | null
          btcpay_tienda_id?: string | null
          cancelada_en?: string | null
          clave_idempotencia: string
          cobrada_en?: string | null
          cobro_estado?: string | null
          cobro_factura?: string | null
          cobro_hash?: string | null
          cobro_intento_en?: string | null
          cobro_intentos?: number
          cobro_intentos_desde?: string | null
          cobro_motivo?: string | null
          cobro_token?: string | null
          cobro_vence_en?: string | null
          codigo: string
          comision_centavos: number
          completada_en?: string | null
          cotizada_en?: string
          creada_en?: string
          destinatario_contacto: string
          destinatario_id?: string | null
          destinatario_nombre: string
          devolucion_estado?: string | null
          devolucion_factura?: string | null
          devolucion_hash?: string | null
          devolucion_intento_en?: string | null
          devolucion_intentos?: number
          devolucion_intentos_desde?: string | null
          devolucion_motivo?: string | null
          devuelta_en?: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado?: Database["public"]["Enums"]["pay_estado"]
          factura?: string | null
          factura_expira?: string | null
          factura_sats?: number | null
          factura_usd_centavos?: number | null
          fallida_en?: string | null
          id?: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo?: string | null
          neto_centavos: number
          nota?: string
          pagada_en?: string | null
          pago_tardio_en?: string | null
          procesando_en?: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        Update: {
          btcpay_factura_id?: string | null
          btcpay_tienda_id?: string | null
          cancelada_en?: string | null
          clave_idempotencia?: string
          cobrada_en?: string | null
          cobro_estado?: string | null
          cobro_factura?: string | null
          cobro_hash?: string | null
          cobro_intento_en?: string | null
          cobro_intentos?: number
          cobro_intentos_desde?: string | null
          cobro_motivo?: string | null
          cobro_token?: string | null
          cobro_vence_en?: string | null
          codigo?: string
          comision_centavos?: number
          completada_en?: string | null
          cotizada_en?: string
          creada_en?: string
          destinatario_contacto?: string
          destinatario_id?: string | null
          destinatario_nombre?: string
          devolucion_estado?: string | null
          devolucion_factura?: string | null
          devolucion_hash?: string | null
          devolucion_intento_en?: string | null
          devolucion_intentos?: number
          devolucion_intentos_desde?: string | null
          devolucion_motivo?: string | null
          devuelta_en?: string | null
          entrega?: Database["public"]["Enums"]["pay_entrega"]
          estado?: Database["public"]["Enums"]["pay_estado"]
          factura?: string | null
          factura_expira?: string | null
          factura_sats?: number | null
          factura_usd_centavos?: number | null
          fallida_en?: string | null
          id?: string
          moneda_destino?: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen?: Database["public"]["Enums"]["pay_moneda"]
          monto_destino?: number
          monto_origen_centavos?: number
          motivo?: string | null
          neto_centavos?: number
          nota?: string
          pagada_en?: string | null
          pago_tardio_en?: string | null
          procesando_en?: string | null
          remitente_id?: string
          tasa?: number
          tasa_fuente?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_transferencias_destinatario_id_fkey"
            columns: ["destinatario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_transferencias_remitente_id_fkey"
            columns: ["remitente_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          categoria_id: number
          creado_en: string
          descripcion: string
          fotos: string[]
          id: string
          negocio_id: string
          nombre: string
          precio_usd_centavos: number
          stock: number
          unidad: string
        }
        Insert: {
          activo?: boolean
          categoria_id: number
          creado_en?: string
          descripcion?: string
          fotos?: string[]
          id?: string
          negocio_id: string
          nombre: string
          precio_usd_centavos: number
          stock?: number
          unidad: string
        }
        Update: {
          activo?: boolean
          categoria_id?: number
          creado_en?: string
          descripcion?: string
          fotos?: string[]
          id?: string
          negocio_id?: string
          nombre?: string
          precio_usd_centavos?: number
          stock?: number
          unidad?: string
        }
        Relationships: [
          {
            foreignKeyName: "productos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "productos_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      resenas: {
        Row: {
          comentario: string
          creada_en: string
          id: string
          negocio_id: string
          orden_id: string
          puntuacion: number
        }
        Insert: {
          comentario?: string
          creada_en?: string
          id?: string
          negocio_id: string
          orden_id: string
          puntuacion: number
        }
        Update: {
          comentario?: string
          creada_en?: string
          id?: string
          negocio_id?: string
          orden_id?: string
          puntuacion?: number
        }
        Relationships: [
          {
            foreignKeyName: "resenas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "resenas_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resenas_orden_id_fkey"
            columns: ["orden_id"]
            isOneToOne: true
            referencedRelation: "ordenes"
            referencedColumns: ["id"]
          },
        ]
      }
      servicios: {
        Row: {
          activo: boolean
          categoria_id: number
          creado_en: string
          descripcion: string
          fotos: string[]
          id: string
          negocio_id: string
          oculto: boolean
          precio_usd_centavos: number | null
          tipo_precio: Database["public"]["Enums"]["tipo_precio"]
          titulo: string
          unidad: string | null
          zona: string
        }
        Insert: {
          activo?: boolean
          categoria_id: number
          creado_en?: string
          descripcion?: string
          fotos?: string[]
          id?: string
          negocio_id: string
          oculto?: boolean
          precio_usd_centavos?: number | null
          tipo_precio: Database["public"]["Enums"]["tipo_precio"]
          titulo: string
          unidad?: string | null
          zona?: string
        }
        Update: {
          activo?: boolean
          categoria_id?: number
          creado_en?: string
          descripcion?: string
          fotos?: string[]
          id?: string
          negocio_id?: string
          oculto?: boolean
          precio_usd_centavos?: number | null
          tipo_precio?: Database["public"]["Enums"]["tipo_precio"]
          titulo?: string
          unidad?: string | null
          zona?: string
        }
        Relationships: [
          {
            foreignKeyName: "servicios_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_servicio"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servicios_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "circularidad_negocios"
            referencedColumns: ["negocio_id"]
          },
          {
            foreignKeyName: "servicios_negocio_id_fkey"
            columns: ["negocio_id"]
            isOneToOne: false
            referencedRelation: "negocios"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          clerk_id: string | null
          creado_en: string
          es_admin: boolean
          id: string
          nombre: string
          telefono: string
        }
        Insert: {
          clerk_id?: string | null
          creado_en?: string
          es_admin?: boolean
          id?: string
          nombre?: string
          telefono: string
        }
        Update: {
          clerk_id?: string | null
          creado_en?: string
          es_admin?: boolean
          id?: string
          nombre?: string
          telefono?: string
        }
        Relationships: []
      }
    }
    Views: {
      circularidad_negocios: {
        Row: {
          indice: number | null
          negocio_id: string | null
          nombre: string | null
          sats_cobrados: number | null
          sats_regastados: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _codigo_entrega: { Args: never; Returns: string }
      _correo_lightning: { Args: { p_direccion: string }; Returns: string }
      _exigir_admin: { Args: { p_actor: string }; Returns: undefined }
      _pay_avanzar: {
        Args: {
          p_actor: string
          p_detalle: string
          p_hacia: Database["public"]["Enums"]["pay_estado"]
          p_motivo: string
          p_transferencia: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _pay_calcular: {
        Args: {
          p_entrega: Database["public"]["Enums"]["pay_entrega"]
          p_moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          p_monto: number
          p_tasa: number
        }
        Returns: {
          comision: number
          monto_destino: number
          neto: number
        }[]
      }
      _pay_codigo: { Args: never; Returns: string }
      _pay_es_admin: { Args: { p_actor: string }; Returns: boolean }
      _pay_nuevo_token: { Args: never; Returns: string }
      _pay_telefono_digitos: { Args: { p_texto: string }; Returns: string }
      _pay_ventana_cobro: { Args: never; Returns: string }
      _rol_en_orden: {
        Args: {
          p_actor: string
          p_orden: Database["public"]["Tables"]["ordenes"]["Row"]
        }
        Returns: string
      }
      _texto_aviso: {
        Args: {
          p_estado: Database["public"]["Enums"]["estado_orden"]
          p_numero: number
          p_para: string
        }
        Returns: string
      }
      _texto_aviso_servicio: {
        Args: {
          p_estado: Database["public"]["Enums"]["estado_orden"]
          p_numero: number
          p_para: string
          p_tipo: Database["public"]["Enums"]["tipo_orden"]
        }
        Returns: string
      }
      _texto_valido: {
        Args: {
          p_max: number
          p_mensaje: string
          p_min: number
          p_texto: string
        }
        Returns: string
      }
      _transicion_orden: {
        Args: {
          p_actor: string
          p_ambas_partes?: boolean
          p_desde: Database["public"]["Enums"]["estado_orden"][]
          p_hacia: Database["public"]["Enums"]["estado_orden"]
          p_orden: string
        }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _usd_texto: { Args: { p_centavos: number }; Returns: string }
      abrir_disputa: {
        Args: {
          p_actor: string
          p_evidencia: string
          p_motivo: string
          p_orden: string
        }
        Returns: {
          creada_en: string
          estado: Database["public"]["Enums"]["estado_disputa"]
          evidencia: string
          id: string
          motivo: string
          nota_resolucion: string
          orden_id: string
          reembolso_confirmado_en: string | null
          reembolso_marcado_en: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          resultado: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        SetofOptions: {
          from: "*"
          to: "disputas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      aceptar_cotizacion: {
        Args: {
          p_actor: string
          p_cotizacion: string
          p_cotizacion_btc: number
        }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      actualizar_negocio: {
        Args: {
          p_abierto: boolean
          p_descripcion: string
          p_lightning_address: string
          p_nombre: string
          p_ubicacion: string
          p_usuario: string
        }
        Returns: {
          abierto: boolean
          btcmap_id: number | null
          btcpay_tienda_id: string | null
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
          tipo_negocio: string | null
          tipo_proveedor_pago: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion: string
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "negocios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      actualizar_perfil: {
        Args: { p_nombre: string; p_usuario: string }
        Returns: {
          clerk_id: string | null
          creado_en: string
          es_admin: boolean
          id: string
          nombre: string
          telefono: string
        }
        SetofOptions: {
          from: "*"
          to: "usuarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      asignar_tienda_btcpay: {
        Args: { p_negocio: string; p_tienda: string }
        Returns: undefined
      }
      cambiar_estado_negocio: {
        Args: {
          p_actor: string
          p_estado: Database["public"]["Enums"]["estado_negocio"]
          p_negocio: string
        }
        Returns: {
          abierto: boolean
          btcmap_id: number | null
          btcpay_tienda_id: string | null
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
          tipo_negocio: string | null
          tipo_proveedor_pago: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion: string
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "negocios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_necesidad: {
        Args: { p_necesidad: string; p_usuario: string }
        Returns: {
          categoria_id: number
          creada_en: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_necesidad"]
          id: string
          oculta: boolean
          presupuesto_usd_centavos: number | null
          titulo: string
          usuario_id: string
          vence_en: string
          zona: string
        }
        SetofOptions: {
          from: "*"
          to: "necesidades"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancelar_orden: {
        Args: { p_actor: string; p_motivo: string; p_orden: string }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cerrar_ordenes: { Args: never; Returns: number }
      circularidad_red: {
        Args: never
        Returns: {
          indice: number
          negocios: number
          negocios_que_compran: number
          porcentaje: number
          sats_cobrados: number
          sats_regastados: number
        }[]
      }
      confirmar_pago: {
        Args: { p_actor: string; p_orden: string }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirmar_reembolso: {
        Args: { p_actor: string; p_orden: string }
        Returns: {
          creada_en: string
          estado: Database["public"]["Enums"]["estado_disputa"]
          evidencia: string
          id: string
          motivo: string
          nota_resolucion: string
          orden_id: string
          reembolso_confirmado_en: string | null
          reembolso_marcado_en: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          resultado: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        SetofOptions: {
          from: "*"
          to: "disputas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      contratar_servicio: {
        Args: {
          p_clave: string
          p_cliente: string
          p_cotizacion_btc: number
          p_nota: string
          p_servicio: string
        }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crear_orden: {
        Args: {
          p_clave: string
          p_comision_bps?: number
          p_comprador: string
          p_cotizacion: number
          p_lineas: Json
          p_modo: Database["public"]["Enums"]["modo_entrega"]
          p_negocio: string
        }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crear_resena: {
        Args: {
          p_actor: string
          p_comentario: string
          p_orden: string
          p_puntuacion: number
        }
        Returns: {
          comentario: string
          creada_en: string
          id: string
          negocio_id: string
          orden_id: string
          puntuacion: number
        }
        SetofOptions: {
          from: "*"
          to: "resenas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      embudo: {
        Args: { p_desde: string; p_hasta: string; p_sitio: string }
        Returns: {
          etiqueta: string
          eventos: number
          nombre: string
          orden: number
          sesiones: number
          valor_usd_centavos: number
        }[]
      }
      enviar_mensaje: {
        Args: { p_actor: string; p_orden: string; p_texto: string }
        Returns: {
          autor_id: string
          creado_en: string
          id: string
          orden_id: string
          texto: string
        }
        SetofOptions: {
          from: "*"
          to: "mensajes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      es_admin: { Args: never; Returns: boolean }
      expirar_ordenes: { Args: never; Returns: number }
      fijar_url_btcpay: { Args: { p_url: string }; Returns: string }
      guardar_producto: {
        Args: {
          p_activo: boolean
          p_categoria: number
          p_descripcion: string
          p_fotos: string[]
          p_nombre: string
          p_precio: number
          p_producto: string
          p_stock: number
          p_unidad: string
          p_usuario: string
        }
        Returns: {
          activo: boolean
          categoria_id: number
          creado_en: string
          descripcion: string
          fotos: string[]
          id: string
          negocio_id: string
          nombre: string
          precio_usd_centavos: number
          stock: number
          unidad: string
        }
        SetofOptions: {
          from: "*"
          to: "productos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      guardar_servicio: {
        Args: {
          p_activo: boolean
          p_categoria: number
          p_descripcion: string
          p_fotos: string[]
          p_precio: number
          p_servicio: string
          p_tipo_precio: Database["public"]["Enums"]["tipo_precio"]
          p_titulo: string
          p_unidad: string
          p_usuario: string
          p_zona: string
        }
        Returns: {
          activo: boolean
          categoria_id: number
          creado_en: string
          descripcion: string
          fotos: string[]
          id: string
          negocio_id: string
          oculto: boolean
          precio_usd_centavos: number | null
          tipo_precio: Database["public"]["Enums"]["tipo_precio"]
          titulo: string
          unidad: string | null
          zona: string
        }
        SetofOptions: {
          from: "*"
          to: "servicios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ledger_guardar_ticket: {
        Args: { p_ticket: Json }
        Returns: {
          buscar: string
          cliente: string
          creado_en: string
          datos: Json
          estado: string
          id: string
          origen_numero: string | null
          origen_plataforma: string | null
          pagado_en: string | null
          payment_hash: string | null
          producto: string | null
          sats: number | null
          total_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ledger_tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ledger_reservar_dte: {
        Args: {
          p_codigo: string
          p_serie: string
          p_ticket: string
          p_tipo: string
        }
        Returns: number
      }
      ledger_siguiente_correlativo: {
        Args: { p_serie: string }
        Returns: number
      }
      ledger_soltar_candado: {
        Args: { p_dueno: string; p_nombre: string }
        Returns: boolean
      }
      ledger_tomar_candado: {
        Args: { p_dueno: string; p_nombre: string; p_segundos: number }
        Returns: boolean
      }
      marcar_avisos_leidos: { Args: { p_usuario: string }; Returns: number }
      marcar_entregada: {
        Args: { p_actor: string; p_codigo: string; p_orden: string }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_hecha: {
        Args: { p_actor: string; p_orden: string }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_lista: {
        Args: { p_actor: string; p_orden: string }
        Returns: {
          cancelada_en: string | null
          cerrada_en: string | null
          clave_idempotencia: string
          codigo_entrega: string | null
          comision_teorica_sats: number
          comprador_id: string
          cotizacion_usd_btc: number
          creada_en: string
          disputada_en: string | null
          entregada_en: string | null
          estado: Database["public"]["Enums"]["estado_orden"]
          expirada_en: string | null
          hecha_en: string | null
          id: string
          lista_en: string | null
          modo_entrega: Database["public"]["Enums"]["modo_entrega"] | null
          motivo_cancelacion: string | null
          negocio_id: string
          numero: number
          pagada_en: string | null
          resuelta_en: string | null
          tipo: Database["public"]["Enums"]["tipo_orden"]
          total_sats: number
          total_usd_centavos: number
        }
        SetofOptions: {
          from: "*"
          to: "ordenes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_reembolso: {
        Args: { p_actor: string; p_orden: string }
        Returns: {
          creada_en: string
          estado: Database["public"]["Enums"]["estado_disputa"]
          evidencia: string
          id: string
          motivo: string
          nota_resolucion: string
          orden_id: string
          reembolso_confirmado_en: string | null
          reembolso_marcado_en: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          resultado: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        SetofOptions: {
          from: "*"
          to: "disputas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_cobro_vigente: {
        Args: { p_lector: string; p_slug: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_confirmar_btcpay: {
        Args: { p_factura_id: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_crear_cobro: {
        Args: {
          p_cotizacion: number
          p_lector: string
          p_precio_sats: number
          p_segundos?: number
          p_slug: string
          p_titulo: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_crear_cobro_btcpay: {
        Args: {
          p_cotizacion: number
          p_expira: string
          p_factura: string
          p_factura_id: string
          p_lector: string
          p_precio_sats: number
          p_slug: string
          p_tienda: string
          p_titulo: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_fallar_cobro: {
        Args: { p_cobro: string; p_motivo: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_lector: {
        Args: { p_lector: string }
        Returns: {
          creado_en: string
          id: string
          visto_en: string
        }
        SetofOptions: {
          from: "*"
          to: "media_lectores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_pagar_cobro: {
        Args: { p_cobro: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cerrada_en: string | null
          cotizacion_usd_btc: number
          creado_en: string
          estado: Database["public"]["Enums"]["media_estado_cobro"]
          expira_en: string
          factura: string
          id: string
          lector_id: string
          motivo: string | null
          pagada_en: string | null
          precio_sats: number
          precio_usd_centavos: number
          proveedor: string
          slug: string
          titulo: string
        }
        SetofOptions: {
          from: "*"
          to: "media_cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      media_resumen: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          cobros: number
          fallidas: number
          pagadas: number
          sats: number
          slug: string
          titulo: string
          usd_centavos: number
          vencidas: number
        }[]
      }
      media_vencer_cobros: { Args: never; Returns: number }
      mi_negocio_id: { Args: never; Returns: string }
      ocultar_necesidad: {
        Args: { p_actor: string; p_necesidad: string; p_oculta: boolean }
        Returns: {
          categoria_id: number
          creada_en: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_necesidad"]
          id: string
          oculta: boolean
          presupuesto_usd_centavos: number | null
          titulo: string
          usuario_id: string
          vence_en: string
          zona: string
        }
        SetofOptions: {
          from: "*"
          to: "necesidades"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ocultar_servicio: {
        Args: { p_actor: string; p_oculto: boolean; p_servicio: string }
        Returns: {
          activo: boolean
          categoria_id: number
          creado_en: string
          descripcion: string
          fotos: string[]
          id: string
          negocio_id: string
          oculto: boolean
          precio_usd_centavos: number | null
          tipo_precio: Database["public"]["Enums"]["tipo_precio"]
          titulo: string
          unidad: string | null
          zona: string
        }
        SetofOptions: {
          from: "*"
          to: "servicios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ofertar: {
        Args: {
          p_mensaje: string
          p_necesidad: string
          p_precio: number
          p_usuario: string
        }
        Returns: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cotizaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_api_cuota: {
        Args: { p_cliente: string; p_maximo: number }
        Returns: boolean
      }
      pay_aplicar_btcpay: {
        Args: { p_estado: string; p_factura_id: string; p_hash: string }
        Returns: Json
      }
      pay_cancelar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_cancelar_cobro: {
        Args: { p_cliente: string; p_id: string }
        Returns: Json
      }
      pay_completar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_confirmar_btcpay: {
        Args: { p_factura_id: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_crear_cliente_api: {
        Args: {
          p_aviso_secreto: string
          p_clave_hash: string
          p_nombre: string
          p_prefijo: string
          p_producto: string
          p_puede_elegir: boolean
          p_tienda: string
          p_tiendas?: string[]
        }
        Returns: string
      }
      pay_crear_transferencia: {
        Args: {
          p_clave: string
          p_comision: number
          p_destinatario_contacto: string
          p_destinatario_nombre: string
          p_entrega: Database["public"]["Enums"]["pay_entrega"]
          p_moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          p_moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          p_monto_destino: number
          p_monto_origen: number
          p_nota: string
          p_remitente: string
          p_tasa: number
          p_tasa_fuente: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_cuota_publica: {
        Args: { p_clave: string; p_maximo: number; p_ventana_segundos: number }
        Returns: boolean
      }
      pay_fallar: {
        Args: { p_actor: string; p_motivo: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_iniciar_cobro: {
        Args: {
          p_factura: string
          p_hash: string
          p_sats: number
          p_token: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_iniciar_devolucion: {
        Args: {
          p_actor: string
          p_factura: string
          p_hash: string
          p_sats: number
          p_transferencia: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_leer_cobro: {
        Args: { p_cliente: string; p_id: string }
        Returns: Json
      }
      pay_liberar_reserva: { Args: { p_id: string }; Returns: boolean }
      pay_cerrar_aviso: {
        Args: { p_aviso: string; p_error: string; p_ok: boolean; p_token: string }
        Returns: string
      }
      pay_reclamar_avisos: {
        Args: { p_aviso?: string; p_duracion_segundos: number; p_limite: number }
        Returns: {
          aviso_id: string
          cobro_id: string
          estado_cobro: string
          intentos: number
          token: string
        }[]
      }
      pay_negocio_crear_cliente: {
        Args: {
          p_aviso_secreto: string
          p_clave_hash: string
          p_negocio: string
          p_prefijo: string
        }
        Returns: string
      }
      pay_negocio_guardar_tienda: {
        Args: { p_negocio: string; p_tienda: string }
        Returns: undefined
      }
      pay_negocio_reclamar: {
        Args: {
          p_nombre: string
          p_tipo: string
          p_ubicacion: string
          p_usuario: string
        }
        Returns: Json
      }
      pay_negocio_soltar: { Args: { p_negocio: string }; Returns: undefined }
      pay_procesar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_recotizar: {
        Args: {
          p_actor: string
          p_comision: number
          p_monto_destino: number
          p_tasa: number
          p_tasa_fuente: string
          p_transferencia: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_registrar_factura: {
        Args: {
          p_actor: string
          p_expira: string
          p_factura: string
          p_factura_id: string
          p_sats: number
          p_tienda: string
          p_transferencia: string
          p_usd_centavos: number
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_registrar_factura_cobro: {
        Args: {
          p_expira: string
          p_factura: string
          p_factura_id: string
          p_id: string
        }
        Returns: Json
      }
      pay_reservar_cobro: {
        Args: {
          p_aviso_url: string
          p_clave: string
          p_cliente: string
          p_datos?: string | null
          p_cotizacion: number
          p_descripcion: string
          p_huella: string
          p_moneda: string
          p_monto: number
          p_referencia: string
          p_sats: number
          p_tienda: string
          p_usd_centavos: number
          p_vence_en_segundos: number
        }
        Returns: Json
      }
      pay_resumen: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          cantidad: number
          comision_usd_centavos: number
          estado: Database["public"]["Enums"]["pay_estado"]
          monto_origen_usd_centavos: number
        }[]
      }
      pay_revocar_cliente_api: { Args: { p_prefijo: string }; Returns: boolean }
      pay_terminar_cobro: {
        Args: {
          p_hash: string
          p_motivo: string
          p_ok: boolean
          p_token: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_terminar_devolucion: {
        Args: {
          p_hash: string
          p_motivo: string
          p_ok: boolean
          p_transferencia: string
        }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: string | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_intento_en: string | null
          cobro_intentos: number
          cobro_intentos_desde: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          cobro_vence_en: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          cotizada_en: string
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
          devolucion_estado: string | null
          devolucion_factura: string | null
          devolucion_hash: string | null
          devolucion_intento_en: string | null
          devolucion_intentos: number
          devolucion_intentos_desde: string | null
          devolucion_motivo: string | null
          devuelta_en: string | null
          entrega: Database["public"]["Enums"]["pay_entrega"]
          estado: Database["public"]["Enums"]["pay_estado"]
          factura: string | null
          factura_expira: string | null
          factura_sats: number | null
          factura_usd_centavos: number | null
          fallida_en: string | null
          id: string
          moneda_destino: Database["public"]["Enums"]["pay_moneda"]
          moneda_origen: Database["public"]["Enums"]["pay_moneda"]
          monto_destino: number
          monto_origen_centavos: number
          motivo: string | null
          neto_centavos: number
          nota: string
          pagada_en: string | null
          pago_tardio_en: string | null
          procesando_en: string | null
          remitente_id: string
          tasa: number
          tasa_fuente: string
        }
        SetofOptions: {
          from: "*"
          to: "pay_transferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pay_vincular_recibidos: { Args: { p_usuario: string }; Returns: number }
      publicar_necesidad: {
        Args: {
          p_categoria: number
          p_descripcion: string
          p_presupuesto: number
          p_titulo: string
          p_usuario: string
          p_zona: string
        }
        Returns: {
          categoria_id: number
          creada_en: string
          descripcion: string
          estado: Database["public"]["Enums"]["estado_necesidad"]
          id: string
          oculta: boolean
          presupuesto_usd_centavos: number | null
          titulo: string
          usuario_id: string
          vence_en: string
          zona: string
        }
        SetofOptions: {
          from: "*"
          to: "necesidades"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      puede_ver_orden: { Args: { p_orden_id: string }; Returns: boolean }
      rechazar_cotizacion: {
        Args: { p_actor: string; p_cotizacion: string }
        Returns: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cotizaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_cobro: {
        Args: {
          p_bolt11: string
          p_destino: string
          p_expira_en: string
          p_orden: string
          p_proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          p_referencia: string
          p_verificar_url: string
        }
        Returns: {
          bolt11: string | null
          destino: string | null
          estado: Database["public"]["Enums"]["estado_cobro"]
          expira_en: string
          id: string
          orden_id: string
          pagado_en: string | null
          proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          referencia_externa: string | null
          verificar_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_cobro_servicio: {
        Args: {
          p_bolt11: string
          p_cotizacion_btc: number
          p_destino: string
          p_expira_en: string
          p_orden: string
          p_proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          p_referencia: string
          p_verificar_url: string
        }
        Returns: {
          bolt11: string | null
          destino: string | null
          estado: Database["public"]["Enums"]["estado_cobro"]
          expira_en: string
          id: string
          orden_id: string
          pagado_en: string | null
          proveedor: Database["public"]["Enums"]["tipo_proveedor"]
          referencia_externa: string | null
          verificar_url: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cobros"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_evento: {
        Args: {
          p_nombre: string
          p_objeto: string
          p_ruta: string
          p_sesion: string
          p_sitio: string
          p_usuario: string
          p_valor: number
        }
        Returns: undefined
      }
      resolver_disputa: {
        Args: {
          p_actor: string
          p_nota: string
          p_orden: string
          p_resultado: Database["public"]["Enums"]["resultado_disputa"]
        }
        Returns: {
          creada_en: string
          estado: Database["public"]["Enums"]["estado_disputa"]
          evidencia: string
          id: string
          motivo: string
          nota_resolucion: string
          orden_id: string
          reembolso_confirmado_en: string | null
          reembolso_marcado_en: string | null
          resuelta_en: string | null
          resuelta_por: string | null
          resultado: Database["public"]["Enums"]["resultado_disputa"] | null
        }
        SetofOptions: {
          from: "*"
          to: "disputas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      responder_cotizacion: {
        Args: {
          p_actor: string
          p_cotizacion: string
          p_mensaje: string
          p_precio: number
        }
        Returns: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cotizaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      retirar_cotizacion: {
        Args: { p_actor: string; p_cotizacion: string }
        Returns: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cotizaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      solicitar_cotizacion: {
        Args: { p_cliente: string; p_descripcion: string; p_servicio: string }
        Returns: {
          cliente_id: string
          creada_en: string
          descripcion_cliente: string
          estado: Database["public"]["Enums"]["estado_cotizacion"]
          id: string
          mensaje: string
          necesidad_id: string | null
          negocio_id: string
          orden_id: string | null
          precio_usd_centavos: number | null
          respondida_en: string | null
          servicio_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cotizaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      solicitar_negocio: {
        Args: {
          p_descripcion: string
          p_lightning_address: string
          p_nombre: string
          p_ubicacion: string
          p_usuario: string
        }
        Returns: {
          abierto: boolean
          btcmap_id: number | null
          btcpay_tienda_id: string | null
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
          tipo_negocio: string | null
          tipo_proveedor_pago: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion: string
          usuario_id: string
        }
        SetofOptions: {
          from: "*"
          to: "negocios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      url_btcpay: { Args: never; Returns: string }
      usuario_actual: { Args: never; Returns: string }
      vencer_necesidades: { Args: never; Returns: number }
      vincular_clerk: {
        Args: {
          p_clerk_id: string
          p_correo: string
          p_nombre: string
          p_telefono: string
        }
        Returns: string
      }
    }
    Enums: {
      estado_cobro: "pendiente" | "pagado" | "expirado" | "cancelado"
      estado_cotizacion:
        | "solicitada"
        | "ofrecida"
        | "aceptada"
        | "rechazada"
        | "retirada"
        | "vencida"
      estado_disputa: "abierta" | "resuelta"
      estado_necesidad: "abierta" | "asignada" | "cancelada" | "vencida"
      estado_negocio: "pendiente" | "aprobado" | "suspendido"
      estado_orden:
        | "creada"
        | "esperando_pago"
        | "pagada"
        | "lista"
        | "entregada"
        | "cerrada"
        | "expirada"
        | "disputada"
        | "resuelta"
        | "acordada"
        | "hecha"
        | "cancelada"
      media_estado_cobro: "pendiente" | "pagada" | "vencida" | "fallida"
      modo_entrega: "recogida" | "entrega_vendedor"
      pay_entrega: "lightning" | "efectivo" | "cuenta"
      pay_estado:
        | "creada"
        | "procesando"
        | "completada"
        | "fallida"
        | "cancelada"
        | "devuelta"
      pay_moneda: "USD" | "EUR" | "SATS"
      resultado_disputa:
        | "reembolso_total"
        | "reembolso_parcial"
        | "sin_reembolso"
        | "corresponde_pagar"
        | "no_corresponde_pagar"
      tipo_orden: "productos" | "servicio"
      tipo_precio: "fijo" | "cotizar"
      tipo_proveedor: "manual" | "falso" | "nwc" | "blink" | "btcpay"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      estado_cobro: ["pendiente", "pagado", "expirado", "cancelado"],
      estado_cotizacion: [
        "solicitada",
        "ofrecida",
        "aceptada",
        "rechazada",
        "retirada",
        "vencida",
      ],
      estado_disputa: ["abierta", "resuelta"],
      estado_necesidad: ["abierta", "asignada", "cancelada", "vencida"],
      estado_negocio: ["pendiente", "aprobado", "suspendido"],
      estado_orden: [
        "creada",
        "esperando_pago",
        "pagada",
        "lista",
        "entregada",
        "cerrada",
        "expirada",
        "disputada",
        "resuelta",
        "acordada",
        "hecha",
        "cancelada",
      ],
      media_estado_cobro: ["pendiente", "pagada", "vencida", "fallida"],
      modo_entrega: ["recogida", "entrega_vendedor"],
      pay_entrega: ["lightning", "efectivo", "cuenta"],
      pay_estado: [
        "creada",
        "procesando",
        "completada",
        "fallida",
        "cancelada",
        "devuelta",
      ],
      pay_moneda: ["USD", "EUR", "SATS"],
      resultado_disputa: [
        "reembolso_total",
        "reembolso_parcial",
        "sin_reembolso",
        "corresponde_pagar",
        "no_corresponde_pagar",
      ],
      tipo_orden: ["productos", "servicio"],
      tipo_precio: ["fijo", "cotizar"],
      tipo_proveedor: ["manual", "falso", "nwc", "blink", "btcpay"],
    },
  },
} as const

