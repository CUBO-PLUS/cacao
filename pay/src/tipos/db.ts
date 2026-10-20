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
          slug: string
          titulo: string
        }
        Insert: {
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
          slug: string
          titulo: string
        }
        Update: {
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
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
          tipo_proveedor_pago: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion: string
          usuario_id: string
        }
        Insert: {
          abierto?: boolean
          creado_en?: string
          credencial_pago_cifrada?: string | null
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_negocio"]
          id?: string
          lightning_address?: string | null
          nombre: string
          tipo_proveedor_pago?: Database["public"]["Enums"]["tipo_proveedor"]
          ubicacion?: string
          usuario_id: string
        }
        Update: {
          abierto?: boolean
          creado_en?: string
          credencial_pago_cifrada?: string | null
          descripcion?: string
          estado?: Database["public"]["Enums"]["estado_negocio"]
          id?: string
          lightning_address?: string | null
          nombre?: string
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
          cobro_estado: "pagando" | "pagado" | "fallido" | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
          cobro_estado?: "pagando" | "pagado" | "fallido" | null
          cobro_factura?: string | null
          cobro_hash?: string | null
          cobro_motivo?: string | null
          cobro_token?: string | null
          codigo: string
          comision_centavos: number
          completada_en?: string | null
          creada_en?: string
          destinatario_contacto: string
          destinatario_id?: string | null
          destinatario_nombre: string
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
          cobro_estado?: "pagando" | "pagado" | "fallido" | null
          cobro_factura?: string | null
          cobro_hash?: string | null
          cobro_motivo?: string | null
          cobro_token?: string | null
          codigo?: string
          comision_centavos?: number
          completada_en?: string | null
          creada_en?: string
          destinatario_contacto?: string
          destinatario_id?: string | null
          destinatario_nombre?: string
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
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
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
      cambiar_estado_negocio: {
        Args: {
          p_actor: string
          p_estado: Database["public"]["Enums"]["estado_negocio"]
          p_negocio: string
        }
        Returns: {
          abierto: boolean
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
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
      pay_cancelar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
      pay_completar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
      pay_fallar: {
        Args: { p_actor: string; p_motivo: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
        Args: { p_factura: string; p_sats: number; p_token: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: "pagando" | "pagado" | "fallido" | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
      pay_terminar_cobro: {
        Args: { p_hash: string | null; p_motivo: string | null; p_ok: boolean; p_token: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          cobrada_en: string | null
          cobro_estado: "pagando" | "pagado" | "fallido" | null
          cobro_factura: string | null
          cobro_hash: string | null
          cobro_motivo: string | null
          cobro_token: string | null
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
      pay_procesar: {
        Args: { p_actor: string; p_transferencia: string }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
        Args: { p_actor: string; p_expira: string; p_factura: string; p_factura_id: string; p_sats: number; p_tienda: string; p_transferencia: string; p_usd_centavos: number }
        Returns: {
          btcpay_factura_id: string | null
          btcpay_tienda_id: string | null
          cancelada_en: string | null
          clave_idempotencia: string
          codigo: string
          comision_centavos: number
          completada_en: string | null
          creada_en: string
          destinatario_contacto: string
          destinatario_id: string | null
          destinatario_nombre: string
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
      pay_resumen: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          cantidad: number
          comision_usd_centavos: number
          estado: Database["public"]["Enums"]["pay_estado"]
          monto_origen_usd_centavos: number
        }[]
      }
      pay_vincular_recibidos: {
        Args: { p_usuario: string }
        Returns: number
      }
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
          creado_en: string
          credencial_pago_cifrada: string | null
          descripcion: string
          estado: Database["public"]["Enums"]["estado_negocio"]
          id: string
          lightning_address: string | null
          nombre: string
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
      pay_moneda: "USD" | "EUR" | "SATS"
      resultado_disputa:
        | "reembolso_total"
        | "reembolso_parcial"
        | "sin_reembolso"
        | "corresponde_pagar"
        | "no_corresponde_pagar"
      tipo_orden: "productos" | "servicio"
      tipo_precio: "fijo" | "cotizar"
      tipo_proveedor: "manual" | "falso" | "nwc" | "blink"
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
      tipo_proveedor: ["manual", "falso", "nwc", "blink"],
    },
  },
} as const

